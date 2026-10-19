import { useMemo, useState } from 'react'
import type { SlotData, SlotHistory } from '../../shared/api.ts'
import { FILM_SIM_LABELS, WBMode, describeRecipe, fxwPhotoUrl, type Recipe, type RecipeValues } from '../../shared/recipe.ts'
import { ExpandButton, useLightbox } from './Lightbox.tsx'
import { Spinner } from './ui.tsx'

export const SLOTS = [1, 2, 3, 4, 5, 6, 7]

/** A change waiting for "Save to camera". */
export interface StagedSlot {
  name: string
  values: Partial<RecipeValues>
  recipeId?: string
}

/** Why a recipe may not land on the camera exactly as written, if anything. */
export function slotCaveat(values: Partial<RecipeValues>): string | null {
  if (values.whiteBalance === WBMode.ColorTemp) {
    return `Kelvin white balance (${values.wbColorTemp ?? 6500}K) may not transfer correctly to X100V slots yet. Check the white balance on the camera after saving and set the Kelvin value there if needed.`
  }
  return null
}

export interface SlotResult {
  ok: boolean
  message: string
}

/** The library recipe a slot most likely holds, matched by name, for its photo. */
export function findRecipeByName(recipes: Recipe[], name: string): Recipe | undefined {
  const n = name.trim().toLowerCase()
  if (!n) return undefined
  return recipes.find(r => r.name.toLowerCase() === n) ?? recipes.find(r => r.name.toLowerCase().replace(/[^a-z0-9]/g, '') === n.replace(/[^a-z0-9]/g, ''))
}

function Photo({ recipe }: { recipe?: Recipe }) {
  const lightbox = useLightbox()
  const photos = recipe?.meta?.photos ?? []
  if (!photos.length) return <div className="slot-photo empty" />
  const items = photos.map(p => ({ src: fxwPhotoUrl(p), caption: recipe!.name }))
  return (
    <div className="slot-photo has-expand" onDoubleClick={() => lightbox(items)}>
      <img src={fxwPhotoUrl(photos[0])} alt="" draggable={false} />
      <ExpandButton className="left" onClick={() => lightbox(items)} />
    </div>
  )
}

export function SlotsView({ onSaveTemplate, connected, slots, loading, history, staged, results, saving, library, onRefresh, onChoose, onUnstage, onCancelAll, onSaveAll, onUndo, onTry, onKeep }: {
  /** Save what's on the camera now as a named template. */
  onSaveTemplate: () => void
  connected: boolean
  slots: SlotData[] | null
  loading: boolean
  history: SlotHistory
  staged: Record<number, StagedSlot>
  results: Record<number, SlotResult>
  saving: number | null
  library: Recipe[]
  onRefresh: () => void
  onChoose: (slot: number) => void
  onUnstage: (slot: number) => void
  onCancelAll: () => void
  onSaveAll: () => void
  onUndo: (slot: number) => void
  onTry: (name: string, values: Partial<RecipeValues>) => void
  onKeep: (name: string, values: Partial<RecipeValues>) => void
}) {
  const pending = Object.keys(staged).length

  if (!connected) {
    return <div className="slots-empty"><h2>Connect the camera to see its C1–C7 slots</h2><p className="dim">Use the Connect camera button at the top right.</p></div>
  }

  return (
    <div className="slots-view">
      <header className="slots-head">
        <div>
          <h2>Camera slots</h2>
          <p className="dim">What's in C1–C7 on your camera. Changes are staged here and only written when you press Save.</p>
        </div>
        <span className="spacer" />
        <button className="ghost" onClick={onSaveTemplate} disabled={loading || saving !== null || Object.keys(staged).length > 0} title={Object.keys(staged).length ? 'Save or cancel the pending changes first' : 'Save C1–C7 as a template'}>Save as template…</button>
        <button className="ghost" onClick={onRefresh} disabled={loading || saving !== null}>{loading ? <><Spinner /> Reading…</> : 'Re-read camera'}</button>
      </header>

      <div className="slots-grid">
        {SLOTS.map(n => {
          const current = slots?.find(s => s.slot === n)
          const next = staged[n]
          const result = results[n]
          const shownName = next ? next.name : current?.name
          const values = next ? next.values : current?.values
          const recipe = next?.recipeId ? library.find(r => r.id === next.recipeId) : findRecipeByName(library, shownName ?? '')
          const canUndo = (history[n]?.length ?? 0) > 0
          return (
            <article key={n} className={`slot${next ? ' staged' : ''}${saving === n ? ' saving' : ''}`}>
              <div className="slot-num">C{n}</div>
              <Photo recipe={recipe} />
              <div className="slot-body">
                {next && <div className="slot-badge">Pending · not saved yet</div>}
                <div className="slot-name">{shownName || <span className="dim">Empty</span>}</div>
                {next && current && <div className="slot-replacing">replacing <s>{current.name || 'empty slot'}</s></div>}
                <div className="slot-sim">{values?.filmSimulation ? FILM_SIM_LABELS[values.filmSimulation] : '—'}</div>
                <div className="slot-desc">{values ? describeRecipe(values) : loading ? 'Reading…' : ''}</div>
                {next && slotCaveat(next.values) && <div className="warn-text">{slotCaveat(next.values)}</div>}
                {result && <div className={result.ok ? 'slot-ok' : 'warn-text'}>{result.message}</div>}
              </div>
              <footer className="slot-actions">
                {saving === n ? (
                  <span className="dim"><Spinner /> Writing…</span>
                ) : next ? (
                  <>
                    <button className="ghost" onClick={() => onChoose(n)}>Change</button>
                    <button className="ghost" onClick={() => onUnstage(n)}>Discard</button>
                  </>
                ) : (
                  <>
                    <button className="ghost" onClick={() => onChoose(n)} disabled={!current}>Replace…</button>
                    {current && <button className="ghost" title="Render this slot's recipe on your RAW" onClick={() => onTry(current.name || `C${n}`, current.values)}>Try</button>}
                    {current?.name && <button className="ghost" title="Copy into your recipes" onClick={() => onKeep(current.name, current.values)}>Keep</button>}
                    {canUndo && <button className="ghost" title={`Put back what was in C${n} before the last save`} onClick={() => onUndo(n)}>Undo</button>}
                  </>
                )}
              </footer>
            </article>
          )
        })}
      </div>

      {pending > 0 && (
        <div className="save-bar">
          <span><b>{pending}</b> {pending === 1 ? 'slot change' : 'slot changes'} waiting</span>
          <span className="dim">Nothing is written to the camera until you save.</span>
          <span className="spacer" />
          <button className="ghost" onClick={onCancelAll} disabled={saving !== null}>Cancel</button>
          <button onClick={onSaveAll} disabled={saving !== null}>{saving !== null ? <><Spinner /> Saving C{saving}…</> : 'Save to camera'}</button>
        </div>
      )}
    </div>
  )
}

/** Pick which slot a recipe goes into. Shows what each slot holds (or will hold). */
export function SlotPicker({ recipe, slots, staged, onPick, onClose }: {
  recipe: Recipe
  slots: SlotData[] | null
  staged: Record<number, StagedSlot>
  onPick: (slot: number) => void
  onClose: () => void
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal slot-picker" onMouseDown={e => e.stopPropagation()}>
        <h2>Add “{recipe.name}” to a slot</h2>
        <p className="dim">It's staged first. Review it in the Camera tab and press Save to write it.</p>
        {slotCaveat(recipe.values) && <p className="warn-text">{slotCaveat(recipe.values)}</p>}
        <div className="slot-pick-list">
          {SLOTS.map(n => {
            const current = slots?.find(s => s.slot === n)
            const next = staged[n]
            return (
              <button key={n} className="slot-pick" onClick={() => onPick(n)}>
                <span className="slot-pick-num">C{n}</span>
                <span className="slot-pick-name">
                  {next ? <>{next.name} <span className="dim">(pending)</span></> : current ? current.name || <span className="dim">Empty</span> : <span className="dim">Not read yet</span>}
                </span>
                <span className="dim">{current?.values.filmSimulation ? FILM_SIM_LABELS[current.values.filmSimulation] : ''}</span>
              </button>
            )
          })}
        </div>
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

/** Choose a recipe for a slot from everything in the library. */
export function RecipePicker({ slot, recipes, onPick, onClose }: {
  slot: number
  recipes: Recipe[]
  onPick: (recipe: Recipe) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = useMemo(() => (q ? recipes.filter(r => `${r.name} ${r.meta?.filmSimulation ?? ''}`.toLowerCase().includes(q)) : recipes).slice(0, 200), [recipes, q])
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal recipe-picker" onMouseDown={e => e.stopPropagation()}>
        <h2>Choose a recipe for C{slot}</h2>
        <input autoFocus className="search" placeholder="Search recipes" value={query} onChange={e => setQuery(e.target.value)} />
        <div className="picker-list">
          {shown.map(r => (
            <button key={r.id} className="picker-row" onClick={() => onPick(r)}>
              {r.meta?.photos[0] ? <img src={fxwPhotoUrl(r.meta.photos[0])} alt="" loading="lazy" /> : <span className="picker-noimg" />}
              <span className="picker-text">
                <span className="recipe-name">{r.name}</span>
                <span className="recipe-desc">{describeRecipe(r.values)}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
