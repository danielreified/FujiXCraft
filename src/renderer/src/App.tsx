import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supportsTiff } from '../../shared/api.ts'
import type { CameraStatus, FxwLibrary, LibraryRaw, RecipeFolder, RenderResult, SlotData, SlotHistory } from '../../shared/api.ts'
import { FXW_RECIPES } from '../../shared/builtin-recipes.ts'
import { BASE_SIM_RECIPES, onNeutralBase, recipeHash, recipeToText, type Recipe, type RecipeKey, type RecipeValues } from '../../shared/recipe.ts'
import { BackupsView } from './Backups.tsx'
import { BatchDialog } from './BatchDialog.tsx'
import { Browse } from './Browse.tsx'
import { Filmstrip } from './Filmstrip.tsx'
import { Editor } from './Editor.tsx'
import { Library } from './Library.tsx'
import { PasteDialog } from './PasteDialog.tsx'
import { CompareView, type CompareStyle } from './Compare.tsx'
import { RecipePicker, SlotPicker, SlotsView, type SlotResult, type StagedSlot } from './Slots.tsx'
import { SingleView, type RenderState } from './Stage.tsx'
import { Spinner } from './ui.tsx'

const lab = window.lab
/** Most recipes to compare at once; beyond this, Split strips get too thin to judge. */
export const MAX_COMPARE = 6
type Tab = 'lab' | 'browse' | 'camera' | 'backups'
const TABS: { id: Tab; label: string }[] = [
  { id: 'lab', label: 'Lab' },
  { id: 'browse', label: 'Browse recipes' },
  { id: 'camera', label: 'Camera slots' },
  { id: 'backups', label: 'Templates' },
]
const AS_SHOT: Recipe = { id: 'as-shot', name: 'As shot', builtIn: true, values: {} }
/** On first run, star the library's versions of the bundled starter recipes. */
const STARTER_NAMES = new Set(FXW_RECIPES.map(r => r.name))

type Dialog = { kind: 'template' } | { kind: 'paste' } | { kind: 'save-as'; values: Partial<RecipeValues>; name: string } | null

const newId = () => `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const message = (err: unknown) => (err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))

export function App() {
  const [status, setStatus] = useState<CameraStatus>({ connected: false, raw: null })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [custom, setCustom] = useState<Recipe[]>([])
  const [activeId, setActiveId] = useState('')
  const [draft, setDraft] = useState<Partial<RecipeValues> | null>(null)
  const [compareIds, setCompareIds] = useState(() => new Set<string>())
  const [tab, setTab] = useState<Tab>('lab')
  const [slots, setSlots] = useState<SlotData[] | null>(null)
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [slotHistory, setSlotHistory] = useState<SlotHistory>({})
  const [staged, setStaged] = useState<Record<number, StagedSlot>>({})
  const [slotResults, setSlotResults] = useState<Record<number, SlotResult>>({})
  const [saving, setSaving] = useState<number | null>(null)
  const [slotPickerFor, setSlotPickerFor] = useState<Recipe | null>(null)
  const [recipePickerFor, setRecipePickerFor] = useState<number | null>(null)
  const [raws, setRaws] = useState<LibraryRaw[]>([])
  const [folders, setFolders] = useState<RecipeFolder[]>([])
  const [batchOpen, setBatchOpen] = useState(false)
  const [neutral, setNeutral] = useState(() => {
    try {
      return localStorage.getItem('neutral-base') !== 'off'
    } catch {
      return true
    }
  })
  const neutralRef = useRef(neutral)
  neutralRef.current = neutral
  /** The settings actually sent to the camera, and the cache key for their render. */
  const effective = useCallback((v: Partial<RecipeValues>) => (neutralRef.current ? onNeutralBase(v) : v), [])
  const keyOf = (v: Partial<RecipeValues>) => recipeHash(neutral ? onNeutralBase(v) : v)
  const [loadingRaw, setLoadingRaw] = useState<string | null>(null)
  const [toast, setToast] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null)
  const [library, setLibrary] = useState<FxwLibrary>({ recipes: [], updated: null })
  const [stars, setStars] = useState<string[]>([])
  const [mode, setMode] = useState<'single' | 'compare'>('single')
  const [compareStyle, setCompareStyle] = useState<CompareStyle>('split')
  const [withAsShot, setWithAsShot] = useState(true)
  const [renders, setRenders] = useState<Record<string, RenderState>>({})
  const [dialog, setDialog] = useState<Dialog>(null)
  const lastShown = useRef<RenderResult | undefined>(undefined)
  const inflight = useRef(new Set<string>())
  const rawPath = status.raw?.path

  useEffect(() => {
    lab.status().then(setStatus)
    lab.listRecipes().then(setCustom)
    lab.listRaws().then(setRaws)
    lab.listFolders().then(setFolders)
    Promise.all([lab.fxwLibrary(), lab.getStars()]).then(([lib, saved]) => {
      setLibrary(lib)
      let ids = saved
      if (!ids) {
        // First run: star the starter recipes that work on an X100V.
        ids = lib.recipes.filter(r => STARTER_NAMES.has(r.name) && r.meta?.cameras.includes('X100V')).map(r => r.id)
        if (ids.length) lab.saveStars(ids)
      }
      setStars(ids)
      setCompareIds(new Set(ids.slice(0, MAX_COMPARE)))
    })
    return lab.onStatus(setStatus)
  }, [])

  // Without the FXW app's library, fall back to the bundled starter recipes.
  const fxwRecipes = library.recipes.length ? library.recipes : FXW_RECIPES
  const starSet = useMemo(() => new Set(stars), [stars])
  const starred = useMemo(
    () => (library.recipes.length ? stars.map(id => library.recipes.find(r => r.id === id)).filter((r): r is Recipe => !!r) : FXW_RECIPES),
    [library, stars],
  )
  // What's on the camera, as recipes the Lab can render.
  const slotRecipes = useMemo<Recipe[]>(
    () => (slots ?? []).map(s => ({ id: `slot-${s.slot}`, name: `C${s.slot} · ${s.name || 'Empty'}`, builtIn: true, values: s.values })),
    [slots],
  )
  const all = useMemo(() => [...custom, ...slotRecipes, ...fxwRecipes, ...BASE_SIM_RECIPES], [custom, slotRecipes, fxwRecipes])
  const camera = status.model ?? 'X100V'
  const forCamera = useMemo(() => library.recipes.filter(r => r.meta?.cameras.includes(camera)), [library, camera])
  const active = all.find(r => r.id === activeId) ?? starred[0] ?? all[0]
  const activeValues = draft ?? active.values
  const dirty = draft !== null

  const persist = (next: Recipe[]) => {
    setCustom(next)
    lab.saveRecipes(next).catch(err => setError(message(err)))
  }

  // ── Rendering ────────────────────────────────────────────

  const render = useCallback((raw: Partial<RecipeValues>, live = false) => {
    const values = effective(raw)
    const hash = recipeHash(values)
    if (!live && inflight.current.has(hash)) return
    inflight.current.add(hash)
    setRenders(prev => (prev[hash]?.status === 'done' ? prev : { ...prev, [hash]: { status: 'pending', previous: lastShown.current } }))
    lab.render({ values, live })
      .then(result => {
        if (result.skipped) return
        setRenders(prev => ({ ...prev, [hash]: { status: 'done', result } }))
      })
      .catch(err => setRenders(prev => ({ ...prev, [hash]: { status: 'error', message: message(err) } })))
      .finally(() => inflight.current.delete(hash))
  }, [effective])

  // A new RAW: start fresh, and render as shot for the hold-to-compare view.
  useEffect(() => {
    setRenders({})
    inflight.current.clear()
    lastShown.current = undefined
    if (rawPath) render({})
  }, [rawPath, render])

  const activeHash = keyOf(activeValues)
  const activeState = renders[activeHash]
  useEffect(() => {
    if (!rawPath || activeState?.status === 'done') return
    const t = setTimeout(() => render(activeValues, dirty), dirty ? 120 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawPath, activeHash])

  useEffect(() => {
    if (activeState?.status === 'done') lastShown.current = activeState.result
  }, [activeState])

  // Keep the selection within the limit (e.g. selections made before the cap existed).
  useEffect(() => {
    if (compareIds.size > MAX_COMPARE) setCompareIds(new Set([...compareIds].slice(0, MAX_COMPARE)))
  }, [compareIds])

  const compareRecipes = [...(withAsShot ? [AS_SHOT] : []), ...all.filter(r => compareIds.has(r.id))]
  useEffect(() => {
    if (!rawPath || mode !== 'compare') return
    for (const r of compareRecipes) if (!renders[keyOf(r.values)]) render(r.values)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawPath, mode, neutral, compareRecipes.map(r => r.id).join()])

  // ── Camera slots ─────────────────────────────────────────

  const readSlots = useCallback(async () => {
    setSlotsLoading(true)
    try {
      const [s, h] = await Promise.all([lab.readSlots(), lab.slotHistory()])
      setSlots(s)
      setSlotHistory(h)
    } catch (err) {
      setError(message(err))
    } finally {
      setSlotsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (status.connected && !slots && !slotsLoading) readSlots()
    if (!status.connected) setSlots(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.connected])

  // ⌘1–⌘4 switch tabs.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey || e.ctrlKey) return
      const i = Number(e.key) - 1
      if (i >= 0 && i < TABS.length) {
        e.preventDefault()
        setTab(TABS[i].id)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(t)
  }, [toast])

  const stage = (slot: number, recipe: Recipe, values = recipe.values) => {
    setStaged(prev => ({ ...prev, [slot]: { name: recipe.name, values, recipeId: recipe.id } }))
    setSlotResults(prev => {
      const next = { ...prev }
      delete next[slot]
      return next
    })
    if (tab !== 'camera') setToast({ text: `“${recipe.name}” is staged for C${slot}. Nothing is written until you save.`, action: { label: 'Review & save', run: () => setTab('camera') } })
  }

  const unstage = (slot: number) =>
    setStaged(prev => {
      const next = { ...prev }
      delete next[slot]
      return next
    })

  const saveSlots = async () => {
    const results: Record<number, SlotResult> = {}
    try {
      await lab.createBackup(`Before saving ${Object.keys(staged).map(n => `C${n}`).join(', ')}`, true)
    } catch (err) {
      setError(`Couldn't back up the slots first, so nothing was saved: ${message(err)}`)
      return
    }
    for (const slot of Object.keys(staged).map(Number).sort()) {
      const s = staged[slot]
      setSaving(slot)
      try {
        const res = await lab.writeSlot(slot, s.name, s.values)
        results[slot] = res.problems.length
          ? { ok: false, message: `Saved, but check: ${res.problems.join('; ')}` }
          : { ok: true, message: 'Saved and verified ✓' }
        unstage(slot)
      } catch (err) {
        results[slot] = { ok: false, message: `Not saved: ${message(err)}` }
      }
      setSlotResults(prev => ({ ...prev, ...results }))
    }
    setSaving(null)
    await readSlots()
  }

  const undoSlot = async (slot: number) => {
    setSaving(slot)
    try {
      await lab.undoSlot(slot)
      setSlotResults(prev => ({ ...prev, [slot]: { ok: true, message: 'Restored the previous contents ✓' } }))
    } catch (err) {
      setSlotResults(prev => ({ ...prev, [slot]: { ok: false, message: message(err) } }))
    } finally {
      setSaving(null)
    }
    await readSlots()
  }

  // ── Actions ──────────────────────────────────────────────

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(null)
    }
  }

  const connect = () => run('Connecting to camera…', async () => setStatus(await lab.connect()))
  const loadRaw = useCallback(async (path: string) => {
    if (!status.connected) {
      setError('Connect the camera to work on a RAW')
      return
    }
    setLoadingRaw(path)
    setError(null)
    try {
      setStatus(await lab.loadRaw(path))
    } catch (err) {
      setError(message(err))
    } finally {
      setLoadingRaw(null)
    }
  }, [status.connected])

  /** Add RAWs to the library, and put the first new one on the camera. */
  const addRaws = async (paths: string[]) => {
    if (!paths.length) return
    const before = new Set(raws.map(r => r.path))
    const next = await lab.addRaws(paths)
    setRaws(next)
    const added = next.filter(r => !before.has(r.path))
    const skipped = paths.length - added.length
    if (skipped > 0) setToast({ text: `${skipped} file${skipped === 1 ? ' was' : 's were'} already in the library or not a Fujifilm RAW.` })
    const first = added[0] ?? next.find(r => r.path === paths[0])
    if (first && status.connected) loadRaw(first.path)
  }
  const openRaw = async () => addRaws(await lab.pickRaws())
  const removeRaw = async (path: string) => setRaws(await lab.removeRaw(path))

  const select = (id: string) => {
    setActiveId(id)
    setDraft(null)
  }

  const change = (key: RecipeKey, value: number | undefined) => {
    const next = { ...activeValues }
    if (value === undefined) delete next[key]
    else next[key] = value
    setDraft(next)
  }

  const toggleStar = (id: string) => {
    const next = starSet.has(id) ? stars.filter(s => s !== id) : [...stars, id]
    setStars(next)
    lab.saveStars(next).catch(err => setError(message(err)))
    if (!starSet.has(id)) setCompareIds(prev => (prev.size < MAX_COMPARE ? new Set(prev).add(id) : prev))
  }

  const tryRecipe = (id: string) => {
    if (!starSet.has(id)) toggleStar(id)
    select(id)
    setTab('lab')
    setMode('single')
  }

  const toggleCompare = (id: string) => {
    if (!compareIds.has(id) && compareIds.size >= MAX_COMPARE) {
      setToast({ text: `You can compare up to ${MAX_COMPARE} recipes. Untick one first.` })
      return
    }
    setCompareIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /**
   * Save one of your recipes. Fuji X Weekly and built-in recipes are never changed;
   * a matching name among *your* recipes is updated in place instead of duplicated.
   */
  const saveNew = (name: string, values: Partial<RecipeValues>) => {
    const existing = findMine(name)
    const recipe: Recipe = { id: existing?.id ?? newId(), name, values }
    persist(existing ? custom.map(r => (r.id === existing.id ? recipe : r)) : [recipe, ...custom])
    setActiveId(recipe.id)
    setDraft(null)
    setCompareIds(prev => (prev.size < MAX_COMPARE ? new Set(prev).add(recipe.id) : prev))
    setDialog(null)
  }

  const findMine = (name: string) => custom.find(r => r.name.trim().toLowerCase() === name.trim().toLowerCase())

  const saveActive = () => {
    persist(custom.map(r => (r.id === active.id ? { ...r, values: activeValues } : r)))
    setDraft(null)
  }

  const deleteActive = () => {
    persist(custom.filter(r => r.id !== active.id))
    select(starred[0]?.id ?? BASE_SIM_RECIPES[0].id)
  }

  const activeDone = activeState?.status === 'done' ? activeState.result : undefined

  /** What saving under this name will do, shown in the save dialog. */
  const nameNote = (name: string): string | null => {
    if (!name.trim()) return null
    if (findMine(name)) return `You already have “${findMine(name)!.name}”. Saving updates it.`
    const fixed = fxwRecipes.find(r => r.name.toLowerCase() === name.trim().toLowerCase())
    if (fixed) return `Same name as a Fuji X Weekly recipe. That one stays as it is; this is saved as yours.`
    return null
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    addRaws([...e.dataTransfer.files].filter(f => /\.raf$/i.test(f.name)).map(f => lab.pathForFile(f)))
  }

  const setNeutralPersist = (on: boolean) => {
    setNeutral(on)
    try {
      localStorage.setItem('neutral-base', on ? 'on' : 'off')
    } catch {
      // Only a preference.
    }
  }

  // ── Layout ───────────────────────────────────────────────

  return (
    <div className="app" onDragOver={e => e.preventDefault()} onDrop={onDrop}>
      <header className="topbar">
        <div className="brand">Recipe<span>Lab</span></div>
        <div className="segmented tabs">
          {TABS.map((t, i) => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} title={`${t.label} (⌘${i + 1})`}>
              {t.label}
              {t.id === 'camera' && Object.keys(staged).length > 0 && <span className="tab-dot">{Object.keys(staged).length}</span>}
              <kbd className="tab-key">⌘{i + 1}</kbd>
            </button>
          ))}
        </div>
        {status.raw && tab === 'lab' && (
          <div className="raw-chip" title={`${status.raw.path}\nSent to the camera in ${status.raw.uploadSeconds.toFixed(1)}s`}>
            <span className="raw-name">{status.raw.name.replace(/\.raf$/i, '')}</span>
            {status.raw.iso && <span className="mono dim">ISO {status.raw.iso}</span>}
          </div>
        )}
        <span className="spacer" />
        {status.raw && tab === 'lab' && (
          <div className="segmented mode">
            <button className={mode === 'single' ? 'on' : ''} onClick={() => setMode('single')}>Single</button>
            <button className={mode === 'compare' ? 'on' : ''} onClick={() => setMode('compare')}>Compare {compareIds.size}/{MAX_COMPARE}</button>
          </div>
        )}
        {tab === 'lab' && <button className="ghost" onClick={openRaw} disabled={!!busy}>Add RAWs…</button>}
        <button className={`camera-pill${status.connected ? ' on' : ''}`} onClick={status.connected ? () => lab.disconnect() : connect} disabled={!!busy}>
          <span className="dot" />
          {status.connected ? `${status.model ?? 'Camera'} · fw ${status.firmware}` : 'Connect camera'}
        </button>
      </header>

      {tab === 'browse' && (
        <div className="browse-host">
          <Browse
            recipes={library.recipes}
            updated={library.updated}
            camera={camera}
            stars={starSet}
            custom={custom}
            onToggleStar={toggleStar}
            onTry={tryRecipe}
            onAddToSlot={setSlotPickerFor}
          />
        </div>
      )}

      {tab === 'backups' && (
        <div className="browse-host">
          <BackupsView
            connected={status.connected}
            onSlotsChanged={readSlots}
            onLibraryChanged={() => {
              lab.listRecipes().then(setCustom)
              lab.listFolders().then(setFolders)
              lab.getStars().then(s => s && setStars(s))
            }}
          />
        </div>
      )}

      {tab === 'camera' && (
        <div className="browse-host">
          <SlotsView
            onSaveTemplate={() => setDialog({ kind: 'template' })}
            connected={status.connected}
            slots={slots}
            loading={slotsLoading}
            history={slotHistory}
            staged={staged}
            results={slotResults}
            saving={saving}
            library={[...custom, ...fxwRecipes]}
            onRefresh={readSlots}
            onChoose={setRecipePickerFor}
            onUnstage={unstage}
            onCancelAll={() => setStaged({})}
            onSaveAll={saveSlots}
            onUndo={undoSlot}
            onTry={(_name, values) => {
              const r = slotRecipes.find(x => recipeHash(x.values) === recipeHash(values))
              if (r) tryRecipe(r.id)
            }}
            onKeep={(name, values) => {
              const nice = name.replace(/\b\w/g, c => c.toUpperCase()).replace(/\B\w/g, c => c.toLowerCase())
              const updating = !!findMine(nice)
              saveNew(nice, values)
              setToast({ text: updating ? `Updated your recipe “${nice}” from the camera.` : `Copied “${nice}” into Your recipes.` })
            }}
          />
        </div>
      )}

      {tab === 'lab' && <>
      <Library
        sections={[
          { key: 'starred', title: library.recipes.length ? '★ Starred' : 'Fuji X Weekly', recipes: starred, open: true },
          { key: 'mine', title: 'Your recipes', recipes: custom },
          { key: 'camera', title: 'On your camera', recipes: slotRecipes },
          ...(library.recipes.length ? [{ key: 'fxw', title: `All Fuji X Weekly for ${camera}`, recipes: forCamera }] : []),
          { key: 'sims', title: 'Film simulations', recipes: BASE_SIM_RECIPES },
        ]}
        activeId={active.id}
        folders={folders}
        allRecipes={all}
        onClearCompare={() => setCompareIds(new Set())}
        onStageFolder={(recipes, folderName) => {
          setStaged(prev => {
            const next = { ...prev }
            recipes.forEach((r, i) => (next[i + 1] = { name: r.name, values: r.values, recipeId: r.id }))
            return next
          })
          setSlotResults({})
          setTab('camera')
          setToast({ text: `“${folderName}” is staged into C1–C${recipes.length}. Review it, then press Save to camera.` })
        }}
        onFoldersChange={next => {
          setFolders(next)
          lab.saveFolders(next).catch(err => setError(message(err)))
        }}
        compareIds={compareIds}
        compareFull={compareIds.size >= MAX_COMPARE}
        stars={starSet}
        onSelect={select}
        onToggleCompare={toggleCompare}
        onToggleStar={toggleStar}
        onPaste={() => setDialog({ kind: 'paste' })}
        onNew={() => setDialog({ kind: 'save-as', values: {}, name: '' })}
      />

      <main className="stage">
        {error && <div className="banner" onClick={() => setError(null)}>{error}<span className="dim"> · click to dismiss</span></div>}
        {busy && <div className="banner info"><Spinner /> {busy}</div>}
        {!status.connected ? (
          <Welcome onConnect={connect} busy={!!busy} />
        ) : !status.raw ? (
          raws.length ? (
            <div className="dropzone quiet">
              <div className="dropzone-title">Pick a RAW from the library below</div>
              <div className="dim">It's sent to the camera, then every recipe renders in a second or two.</div>
            </div>
          ) : (
            <div className="dropzone" onClick={openRaw}>
              <div className="dropzone-title">Drop X100V RAWs here</div>
              <div className="dim">or click to choose .RAF files or a folder. They go into your library; one at a time is sent to the camera.</div>
            </div>
          )
        ) : mode === 'single' ? (
          <SingleView recipe={dirty ? { ...active, name: `${active.name} (edited)` } : active} state={activeState} asShot={renders[recipeHash({})]} />
        ) : (
          <>
            <div className="compare-bar">
              <div className="segmented">
                {(['split', 'flip', 'grid'] as const).map(st => (
                  <button key={st} className={compareStyle === st ? 'on' : ''} onClick={() => setCompareStyle(st)}>
                    {st === 'split' ? 'Split' : st === 'flip' ? 'Flip' : 'Grid'}
                  </button>
                ))}
              </div>
              <NeutralToggle on={neutral} onChange={setNeutralPersist} />
              <label className="toggle">
                <input type="checkbox" checked={withAsShot} onChange={e => setWithAsShot(e.target.checked)} /> Include as shot
              </label>
            </div>
            <CompareView
              style={compareStyle}
              items={compareRecipes.map(r => ({ recipe: r, state: renders[keyOf(r.values)] }))}
              activeId={active.id}
              onSelect={id => {
                if (id === AS_SHOT.id) return
                select(id)
                setMode('single')
              }}
              onRemove={id => (id === AS_SHOT.id ? setWithAsShot(false) : toggleCompare(id))}
            />
          </>
        )}
        {status.raw && activeDone && mode === 'single' && (
          <div className="stage-actions">
            <button className="ghost" onClick={() => navigator.clipboard.writeText(recipeToText(active.name, activeValues))}>Copy recipe text</button>
            <button className="ghost" onClick={() => lab.reveal(activeDone.fullPath)}>Show in Finder</button>
            <button className="ghost" title="Render this recipe onto many RAWs" onClick={() => setBatchOpen(true)}>Batch export…</button>
            {supportsTiff(status.model) && <button className="ghost" title="16-bit uncompressed TIFF (~150 MB) for heavy editing in LightCraft" onClick={() =>
              run('Rendering 16-bit TIFF on the camera…', async () => {
                const path = await lab.exportAs(effective(activeValues), 'tiff16', `${status.raw!.name.replace(/\.raf$/i, '')} - ${active.name}`)
                if (path) setToast({ text: 'TIFF saved.', action: { label: 'Show in Finder', run: () => lab.reveal(path) } })
              })
            }>Export TIFF</button>}
            <button onClick={() => lab.exportJpeg(activeDone.fullPath, `${status.raw!.name.replace(/\.raf$/i, '')} - ${active.name}.jpg`)}>Export full-size JPEG</button>
          </div>
        )}
        {(raws.length > 0 || status.connected) && (
          <Filmstrip raws={raws} activePath={status.raw?.path} loadingPath={loadingRaw} onOpen={loadRaw} onAdd={openRaw} onRemove={removeRaw} />
        )}
      </main>

      <Editor
        recipe={active}
        values={activeValues}
        dirty={dirty}
        onChange={change}
        onSave={saveActive}
        onSaveAs={() => setDialog({ kind: 'save-as', values: activeValues, name: dirty || active.builtIn ? `${active.name} (mine)` : active.name })}
        onRevert={() => setDraft(null)}
        onDelete={deleteActive}
        headerExtra={<NeutralToggle on={neutral} onChange={setNeutralPersist} />}
        onAddToSlot={() => setSlotPickerFor({ ...active, values: activeValues, name: dirty ? `${active.name} (edited)` : active.name.replace(/^C\d · /, '') })}
      />
      </>}

      {batchOpen && (
        <BatchDialog
          raws={raws}
          tiff={supportsTiff(status.model)}
          recipeName={dirty ? `${active.name} (edited)` : active.name.replace(/^C\d · /, '')}
          values={effective(activeValues)}
          onClose={() => setBatchOpen(false)}
        />
      )}
      {slotPickerFor && (
        <SlotPicker
          recipe={slotPickerFor}
          slots={slots}
          staged={staged}
          onPick={slot => {
            stage(slot, slotPickerFor)
            setSlotPickerFor(null)
          }}
          onClose={() => setSlotPickerFor(null)}
        />
      )}
      {recipePickerFor !== null && (
        <RecipePicker
          slot={recipePickerFor}
          recipes={[...custom, ...forCamera, ...fxwRecipes.filter(r => !forCamera.includes(r)), ...BASE_SIM_RECIPES].filter((r, i, a) => a.findIndex(x => x.id === r.id) === i)}
          onPick={r => {
            stage(recipePickerFor, r)
            setRecipePickerFor(null)
          }}
          onClose={() => setRecipePickerFor(null)}
        />
      )}
      {toast && (
        <div className="toast">
          <span>{toast.text}</span>
          {toast.action && <button onClick={() => { toast.action!.run(); setToast(null) }}>{toast.action.label}</button>}
          <button className="ghost" onClick={() => setToast(null)}>✕</button>
        </div>
      )}

      {dialog?.kind === 'template' && (
        <TemplateDialog
          slots={slots}
          onCancel={() => setDialog(null)}
          onSave={async name => {
            setDialog(null)
            try {
              const b = await lab.createBackup(name)
              setToast({ text: `Saved “${b.label}” as a template.`, action: { label: 'View templates', run: () => setTab('backups') } })
            } catch (err) {
              setError(message(err))
            }
          }}
        />
      )}
      {dialog?.kind === 'paste' && (
        <PasteDialog title="Paste a recipe" initialName="" initialText="" onCancel={() => setDialog(null)} onSave={saveNew} nameNote={nameNote} />
      )}
      {dialog?.kind === 'save-as' && (
        <PasteDialog
          title="Save recipe"
          initialName={dialog.name}
          initialText={recipeToText(dialog.name, dialog.values).split('\n').slice(1).join('\n')}
          onCancel={() => setDialog(null)}
          onSave={saveNew}
          nameNote={nameNote}
        />
      )}
    </div>
  )
}

/** Neutral base: settings a recipe leaves out use factory defaults instead of the RAW's own. */
function NeutralToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="toggle" title="On: settings a recipe doesn't set use factory defaults, so a recipe looks the same on every photo. Off: they come from how the photo was shot.">
      <input type="checkbox" checked={on} onChange={e => onChange(e.target.checked)} /> Neutral base
    </label>
  )
}

function TemplateDialog({ slots, onCancel, onSave }: { slots: SlotData[] | null; onCancel: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState('')
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal" onMouseDown={e => e.stopPropagation()}>
        <h2>Save as template</h2>
        <p className="dim">Saves all seven slots exactly as they are on the camera, so you can load them back any time from Templates (⌘4).</p>
        <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Summer set" onKeyDown={e => e.key === 'Enter' && name.trim() && onSave(name.trim())} />
        <div className="template-preview">{(slots ?? []).map(s => <span key={s.slot}><b>C{s.slot}</b> {s.name || 'Empty'}</span>)}</div>
        <div className="modal-actions">
          <button className="ghost" onClick={onCancel}>Cancel</button>
          <button disabled={!name.trim()} onClick={() => onSave(name.trim())}>Save template</button>
        </div>
      </div>
    </div>
  )
}

function Welcome({ onConnect, busy }: { onConnect: () => void; busy: boolean }) {
  return (
    <div className="welcome">
      <div className="welcome-mark">◐</div>
      <h1>Your camera is the render engine.</h1>
      <p>Recipe Lab sends a RAW to your Fujifilm over USB and the camera renders it with any recipe, using real Fuji colour, at full resolution.</p>
      <ol>
        <li>Turn the camera on and plug it in with a USB‑C cable.</li>
        <li>On the camera: <b>Menu → Set Up → Connection Setting → PC Connection Mode → USB RAW CONV./BACKUP RESTORE</b>.</li>
        <li>Quit X RAW Studio, X Acquire and the Fuji X Weekly app if they're open.</li>
      </ol>
      <button className="big" onClick={onConnect} disabled={busy}>Connect camera</button>
    </div>
  )
}
