import { useEffect, useRef } from 'react'
import { rawThumbUrl, type LibraryRaw } from '../../shared/api.ts'
import { Spinner } from './ui.tsx'

/** The RAW library along the bottom of the Lab. One RAW is on the camera at a time. */
export function Filmstrip({ raws, activePath, loadingPath, onOpen, onAdd, onRemove }: {
  raws: LibraryRaw[]
  activePath?: string
  loadingPath: string | null
  onOpen: (path: string) => void
  onAdd: () => void
  onRemove: (path: string) => void
}) {
  const strip = useRef<HTMLDivElement>(null)

  // [ and ] step through the library.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || loadingPath) return
      if (e.key !== '[' && e.key !== ']') return
      const usable = raws.filter(r => !r.missing)
      if (!usable.length) return
      const i = usable.findIndex(r => r.path === activePath)
      const next = e.key === ']' ? (i + 1) % usable.length : (i - 1 + usable.length) % usable.length
      onOpen(usable[i < 0 ? 0 : next].path)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [raws, activePath, loadingPath, onOpen])

  // Keep the active RAW in view.
  useEffect(() => {
    strip.current?.querySelector('.film.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [activePath])

  return (
    <div className="filmstrip">
      <div className="filmstrip-head">
        <span>RAW library <span className="dim">· {raws.length}</span></span>
        <span className="dim">Click to send one to the camera · <kbd>[</kbd> <kbd>]</kbd> to step</span>
      </div>
      <div className="filmstrip-row" ref={strip}>
        {raws.map(r => (
          <figure
            key={r.path}
            className={`film${r.path === activePath ? ' active' : ''}${r.missing ? ' missing' : ''}`}
            title={r.missing ? `${r.path} (missing)` : r.path}
            onClick={() => !r.missing && !loadingPath && onOpen(r.path)}
          >
            <div className="film-img">
              {!r.missing && <img src={rawThumbUrl(r.path)} alt="" loading="lazy" draggable={false} />}
              {loadingPath === r.path && <div className="film-busy"><Spinner /></div>}
              {r.path === activePath && <span className="film-badge">On camera</span>}
              <button
                className="film-remove"
                title="Remove from library (the file stays on disk)"
                onClick={e => {
                  e.stopPropagation()
                  onRemove(r.path)
                }}
              >
                ✕
              </button>
            </div>
            <figcaption>
              <span className="film-name">{r.name.replace(/\.raf$/i, '')}</span>
              <span className="mono dim">{r.missing ? 'missing' : r.iso ? `ISO ${r.iso}` : ''}</span>
            </figcaption>
          </figure>
        ))}
        <button className="film-add" onClick={onAdd}>
          <span>＋</span>
          Add RAWs
        </button>
      </div>
    </div>
  )
}
