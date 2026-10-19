import { useEffect, useState } from 'react'
import { rawThumbUrl, type BatchProgress, type ExportFormat, type BatchSummary, type LibraryRaw } from '../../shared/api.ts'
import { describeRecipe, type RecipeValues } from '../../shared/recipe.ts'
import { Spinner } from './ui.tsx'

const lab = window.lab

/** Render one recipe onto many RAWs through the camera and save the JPEGs. */
export function BatchDialog({ raws, tiff, recipeName, values, onClose }: {
  raws: LibraryRaw[]
  /** The connected camera can render TIFF over USB. */
  tiff: boolean
  recipeName: string
  values: Partial<RecipeValues>
  onClose: () => void
}) {
  const usable = raws.filter(r => !r.missing)
  const [picked, setPicked] = useState(() => new Set(usable.map(r => r.path)))
  const [outDir, setOutDir] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [states, setStates] = useState<Record<string, BatchProgress>>({})
  const [current, setCurrent] = useState<BatchProgress | null>(null)
  const [summary, setSummary] = useState<BatchSummary | null>(null)
  const [startedAt, setStartedAt] = useState(0)
  const [format, setFormat] = useState<ExportFormat>('jpeg')

  useEffect(
    () =>
      lab.onBatchProgress(p => {
        setCurrent(p)
        setStates(prev => ({ ...prev, [p.name]: p }))
      }),
    [],
  )

  const paths = usable.filter(r => picked.has(r.path)).map(r => r.path)
  const finished = current ? Object.values(states).filter(s => s.state !== 'rendering').length : 0
  const elapsed = startedAt ? (Date.now() - startedAt) / 1000 : 0
  const perPhoto = finished ? elapsed / finished : 5
  const remaining = Math.max(0, Math.round((paths.length - finished) * perPhoto))

  const toggle = (path: string) =>
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const chooseFolder = async () => {
    const dir = await lab.pickBatchFolder()
    if (dir) setOutDir(dir)
  }

  const start = async () => {
    if (!outDir || !paths.length) return
    setRunning(true)
    setStates({})
    setSummary(null)
    setStartedAt(Date.now())
    const result = await lab.runBatch({ paths, recipeName, values, outDir, format })
    setSummary(result)
    setRunning(false)
  }

  const nameOf = (r: LibraryRaw) => r.name.replace(/\.raf$/i, '')

  return (
    <div className="modal-backdrop" onMouseDown={running ? undefined : onClose}>
      <div className="modal batch" onMouseDown={e => e.stopPropagation()}>
        <h2>Batch export</h2>
        <div className="batch-recipe">
          <span className="batch-recipe-name">{recipeName}</span>
          <span className="dim">{describeRecipe(values)}</span>
        </div>

        <div className="batch-head">
          <span>{paths.length} of {usable.length} RAWs</span>
          {!running && !summary && (
            <span className="batch-links">
              <button className="link" onClick={() => setPicked(new Set(usable.map(r => r.path)))}>All</button>
              <button className="link" onClick={() => setPicked(new Set())}>None</button>
            </span>
          )}
        </div>

        <div className="batch-list">
          {usable.map(r => {
            const st = states[nameOf(r)]
            return (
              <label key={r.path} className={`batch-item${picked.has(r.path) ? '' : ' off'}`}>
                <input type="checkbox" checked={picked.has(r.path)} disabled={running || !!summary} onChange={() => toggle(r.path)} />
                <img src={rawThumbUrl(r.path)} alt="" loading="lazy" />
                <span className="batch-name">{nameOf(r)}</span>
                <span className="batch-state">
                  {st?.state === 'rendering' && <Spinner />}
                  {st?.state === 'done' && <span className="slot-ok">✓</span>}
                  {st?.state === 'failed' && <span className="warn-text" title={st.error}>failed</span>}
                </span>
              </label>
            )
          })}
        </div>

        {tiff && <div className="batch-out">
          <span className="dim">Format</span>
          <div className="segmented">
            <button className={format === 'jpeg' ? 'on' : ''} disabled={running || !!summary} onClick={() => setFormat('jpeg')}>JPEG</button>
            <button className={format === 'tiff16' ? 'on' : ''} disabled={running || !!summary} onClick={() => setFormat('tiff16')}>TIFF 16-bit</button>
          </div>
          <span className="dim">{format === 'tiff16' ? `~${Math.round(paths.length * 0.156 * 10) / 10} GB, for heavy editing` : '~17 MB each'}</span>
        </div>}
        <div className="batch-out">
          <span className="dim">Save to</span>
          <span className="batch-dir" title={outDir ?? ''}>{outDir ?? 'No folder chosen'}</span>
          {!running && !summary && <button className="ghost" onClick={chooseFolder}>{outDir ? 'Change…' : 'Choose folder…'}</button>}
        </div>

        {running && current && (
          <div className="batch-progress">
            <div className="bar"><div style={{ width: `${(finished / paths.length) * 100}%` }} /></div>
            <span className="dim">{finished} / {paths.length} · rendering {current.name} · about {remaining}s left</span>
          </div>
        )}

        {summary && (
          <div className="batch-summary">
            <b>{summary.cancelled ? 'Stopped.' : 'Done.'}</b> {summary.done} JPEG{summary.done === 1 ? '' : 's'} saved
            {summary.failed.length > 0 && <span className="warn-text"> · {summary.failed.length} failed ({summary.failed.map(f => `${f.name}: ${f.error}`).join('; ')})</span>}
            {summary.notes > 0 && <span className="dim"> · {summary.notes} had dynamic range limited by their ISO</span>}
          </div>
        )}

        <div className="modal-actions">
          {running ? (
            <button className="ghost" onClick={() => lab.cancelBatch()}>Stop after this photo</button>
          ) : summary ? (
            <>
              <button className="ghost" onClick={() => lab.openPath(summary.outDir)}>Open folder</button>
              <button onClick={onClose}>Close</button>
            </>
          ) : (
            <>
              <button className="ghost" onClick={onClose}>Cancel</button>
              <button disabled={!outDir || !paths.length} onClick={start}>
                Export {paths.length} {format === 'tiff16' ? 'TIFF' : 'JPEG'}{paths.length === 1 ? '' : 's'} · ~{Math.max(1, Math.round((paths.length * 5) / 60))} min
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
