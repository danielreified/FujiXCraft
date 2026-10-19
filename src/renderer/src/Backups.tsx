import { useCallback, useEffect, useState } from 'react'
import type { SlotBackup, SlotData, XAcquireBackup } from '../../shared/api.ts'
import { FILM_SIM_LABELS, FilmSim } from '../../shared/recipe.ts'
import { Spinner } from './ui.tsx'

const lab = window.lab
const message = (err: unknown) => (err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

/** A colour per film simulation family, for the slot chips. */
function simTone(sim?: number): string {
  switch (sim) {
    case FilmSim.ClassicChrome: return '#5f9ea0'
    case FilmSim.ClassicNeg: return '#c9824a'
    case FilmSim.Velvia: return '#c0504d'
    case FilmSim.Astia: return '#d9a3b5'
    case FilmSim.Eterna:
    case FilmSim.EternaBleach: return '#7b8f6a'
    case FilmSim.ProNegHi:
    case FilmSim.ProNegStd: return '#c9b07a'
    case FilmSim.Provia: return '#6b8fc9'
    default: return '#9a958c' // monochrome and the rest
  }
}

function SlotChip({ s, onLoad, disabled }: { s: SlotData; onLoad?: () => void; disabled?: boolean }) {
  const sim = s.values.filmSimulation
  return (
    <div className={`tchip${s.name ? '' : ' empty'}`} style={{ '--tone': simTone(sim) } as React.CSSProperties}>
      <span className="tchip-num">C{s.slot}</span>
      <span className="tchip-name">{s.name || 'Empty'}</span>
      <span className="tchip-sim">{sim ? FILM_SIM_LABELS[sim] : ''}</span>
      {onLoad && (
        <button className="tchip-load" disabled={disabled} title={`Load only C${s.slot} onto the camera`} onClick={onLoad}>
          Load C{s.slot}
        </button>
      )}
    </div>
  )
}

export function BackupsView({ connected, onSlotsChanged, onLibraryChanged }: {
  connected: boolean
  /** Slots on the camera changed (after loading a template). */
  onSlotsChanged: () => void
  /** Recipes, folders or stars changed (after an import). */
  onLibraryChanged: () => void
}) {
  const [backups, setBackups] = useState<SlotBackup[]>([])
  const [xacquire, setXAcquire] = useState<XAcquireBackup[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [confirm, setConfirm] = useState<{ backup: SlotBackup; slots?: number[] } | null>(null)
  const [naming, setNaming] = useState(false)

  const refresh = useCallback(async () => {
    setBackups(await lab.listBackups())
    setXAcquire(await lab.findXAcquireBackups())
  }, [])
  useEffect(() => {
    refresh()
  }, [refresh])

  const run = async (what: string, fn: () => Promise<string | void>) => {
    setBusy(what)
    setNote(null)
    try {
      const text = await fn()
      if (text) setNote({ ok: true, text })
    } catch (err) {
      setNote({ ok: false, text: message(err) })
    } finally {
      setBusy(null)
      refresh()
    }
  }

  const saveTemplate = (name: string) =>
    run('Reading C1–C7 from the camera…', async () => {
      const b = await lab.createBackup(name.trim() || `Template ${new Date().toLocaleDateString()}`)
      setNaming(false)
      return `Saved “${b.label}”.`
    })

  const load = (backup: SlotBackup, slots?: number[]) =>
    run(`Loading ${slots ? `C${slots.join(', C')}` : 'all seven slots'} onto the camera…`, async () => {
      const done = await lab.restoreBackup(backup.id, slots)
      onSlotsChanged()
      return `Loaded ${done.map(s => `C${s.slot}`).join(', ')} from “${backup.label}”. What was on the camera before is in History.`
    })

  const templates = backups.filter(b => !b.auto)
  const history = backups.filter(b => b.auto)
  const latest = templates[0]

  const templateCard = (b: SlotBackup, compact = false) => (
    <article key={b.id} className={`tcard${compact ? ' compact' : ''}`}>
      <header className="tcard-head">
        <div>
          <div className="tcard-name">{b.label}</div>
          <div className="dim">{when(b.createdAt)}{b.camera ? ` · ${b.camera}` : ''}</div>
        </div>
        <span className="spacer" />
        <button disabled={!connected || !!busy} onClick={() => setConfirm({ backup: b })}>Load onto camera</button>
      </header>
      <div className="tchips">
        {b.slots.map(s => (
          <SlotChip key={s.slot} s={s} disabled={!connected || !!busy} onLoad={() => setConfirm({ backup: b, slots: [s.slot] })} />
        ))}
      </div>
      <footer className="tcard-foot">
        <button className="link" onClick={() => run('Exporting…', async () => ((await lab.exportBackup(b.id)) ? 'Exported.' : undefined))}>Export file</button>
        <span className="spacer" />
        <button className="link danger" onClick={() => run('Deleting…', async () => void (await lab.deleteBackup(b.id)))}>Delete</button>
      </footer>
    </article>
  )

  return (
    <div className="templates-view">
      <section className="thero">
        <div className="thero-text">
          <div className="eyebrow">Templates</div>
          <h1>Sets of seven, ready to swap.</h1>
          <p className="dim">Save everything in C1–C7 as a template (a summer set, a bad-weather set, a street set) and load any of them back onto the camera in one click.</p>
        </div>
        <div className="thero-side">
          <div className="thero-stat">
            <span className="thero-num">{templates.length}</span>
            <span className="dim">template{templates.length === 1 ? '' : 's'}</span>
          </div>
          <div className="thero-stat">
            <span className="thero-num small">{latest ? ago(latest.createdAt) : '—'}</span>
            <span className="dim">last saved</span>
          </div>
        </div>
      </section>

      <div className="tactions">
        {naming ? (
          <form className="tname" onSubmit={e => {
            e.preventDefault()
            saveTemplate(new FormData(e.currentTarget).get('name') as string)
          }}>
            <input name="name" autoFocus className="search" placeholder="Template name (e.g. Summer set)" />
            <button type="submit" disabled={!connected || !!busy}>Save</button>
            <button type="button" className="ghost" onClick={() => setNaming(false)}>Cancel</button>
          </form>
        ) : (
          <button disabled={!connected || !!busy} onClick={() => setNaming(true)}>＋ Save camera as template</button>
        )}
        <button className="ghost" onClick={() => run('Importing…', async () => void (await lab.importBackup()))}>Import file…</button>
        {!connected && <span className="warn-text">Connect the camera to save or load templates.</span>}
      </div>

      {busy && <div className="tbusy"><Spinner /> {busy}</div>}
      {note && <div className={`backup-note${note.ok ? '' : ' bad'}`} onClick={() => setNote(null)}>{note.text}</div>}

      <div className="tgrid">
        {templates.length ? templates.map(b => templateCard(b)) : (
          <div className="tempty">
            <div className="tempty-icon">▦</div>
            <div>No templates yet. Set up C1–C7 the way you like, then <b>Save camera as template</b>.</div>
          </div>
        )}
      </div>

      {history.length > 0 && (
        <details className="thistory">
          <summary>History <span className="dim">· {history.length} automatic snapshot{history.length === 1 ? '' : 's'} taken before each save or load</span></summary>
          <div className="tgrid">{history.map(b => templateCard(b, true))}</div>
        </details>
      )}

      <div className="tmore">
        <article className="mini-card">
          <div className="mini-icon">⇄</div>
          <div className="mini-body">
            <h3>Your Recipe Lab library</h3>
            <p className="dim">Your recipes, folders and stars in one file, for another Mac or after a reinstall. Importing only adds what's new.</p>
            <div className="mini-actions">
              <button className="ghost" onClick={() => run('Exporting…', async () => ((await lab.exportLibrary()) ? 'Library exported.' : undefined))}>Export…</button>
              <button className="ghost" onClick={() => run('Importing…', async () => {
                const r = await lab.importLibrary()
                if (!r) return
                onLibraryChanged()
                return `Imported ${r.recipes} recipe${r.recipes === 1 ? '' : 's'}, ${r.folders} folder${r.folders === 1 ? '' : 's'} and ${r.stars} star${r.stars === 1 ? '' : 's'}.`
              })}>Import…</button>
            </div>
          </div>
        </article>

        <article className="mini-card">
          <div className="mini-icon">⛭</div>
          <div className="mini-body">
            <h3>Full camera settings</h3>
            <p className="dim">Menus, buttons, Q menu and all: use Fujifilm's X Acquire (menu-bar icon → Backup / Restore Camera Settings). Disconnect here first.</p>
            {xacquire.slice(0, 3).map(x => (
              <button key={x.path} className="xa-file" onClick={() => lab.reveal(x.path)} title="Show in Finder">
                <span className="mono">{x.name}</span>
                <span className="dim">{when(x.modified)}</span>
              </button>
            ))}
            <div className="mini-actions">
              <button className="ghost" onClick={() => lab.openXAcquire()}>Open X Acquire</button>
            </div>
          </div>
        </article>
      </div>

      {confirm && (
        <div className="modal-backdrop" onMouseDown={() => setConfirm(null)}>
          <div className="modal" onMouseDown={e => e.stopPropagation()}>
            <h2>Load {confirm.slots ? `C${confirm.slots[0]}` : 'all seven slots'} from “{confirm.backup.label}”?</h2>
            <p className="dim">
              {confirm.slots ? `C${confirm.slots[0]}` : 'C1–C7'} on the camera will be replaced. What's there now is saved to History first, so you can always go back.
            </p>
            <div className="tchips small">
              {confirm.backup.slots.filter(s => !confirm.slots || confirm.slots.includes(s.slot)).map(s => <SlotChip key={s.slot} s={s} />)}
            </div>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setConfirm(null)}>Cancel</button>
              <button onClick={() => {
                const c = confirm
                setConfirm(null)
                load(c.backup, c.slots)
              }}>Load onto camera</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
