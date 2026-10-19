import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

export interface LightboxItem {
  src: string
  caption: string
  detail?: string
}

type Open = (items: LightboxItem[], index?: number) => void

const LightboxContext = createContext<Open>(() => undefined)

/** Open the full-screen viewer from anywhere: `useLightbox()(items, index)`. */
export const useLightbox = () => useContext(LightboxContext)

export function LightboxProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ items: LightboxItem[]; index: number } | null>(null)
  const open = useCallback<Open>((items, index = 0) => {
    if (items.length) setState({ items, index: Math.max(0, Math.min(index, items.length - 1)) })
  }, [])
  return (
    <LightboxContext.Provider value={open}>
      {children}
      {state && <Viewer items={state.items} start={state.index} onClose={() => setState(null)} />}
    </LightboxContext.Provider>
  )
}

/** The ⤢ button shown on hover over any image. */
export function ExpandButton({ onClick, className = '' }: { onClick: () => void; className?: string }) {
  return (
    <button
      className={`expand-btn ${className}`}
      title="Expand (or double-click the image)"
      onClick={e => {
        e.stopPropagation()
        onClick()
      }}
      onDoubleClick={e => e.stopPropagation()}
    >
      ⤢
    </button>
  )
}

function Viewer({ items, start, onClose }: { items: LightboxItem[]; start: number; onClose: () => void }) {
  const [index, setIndex] = useState(start)
  const [zoom, setZoom] = useState(false)
  const [origin, setOrigin] = useState({ x: 50, y: 50 })
  const item = items[index]
  const many = items.length > 1

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' && many) setIndex(i => (i + 1) % items.length)
      else if (e.key === 'ArrowLeft' && many) setIndex(i => (i - 1 + items.length) % items.length)
      else if (e.key.toLowerCase() === 'z') setZoom(z => !z)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    // Capture, so views underneath (e.g. Flip's arrow keys) don't also react.
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [items.length, many, onClose])

  const track = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    setOrigin({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 })
  }

  return (
    <div className="lightbox" onMouseDown={onClose}>
      <header className="lightbox-bar" onMouseDown={e => e.stopPropagation()}>
        <div>
          <div className="lightbox-title">{item.caption}</div>
          {item.detail && <div className="dim">{item.detail}</div>}
        </div>
        <span className="spacer" />
        {many && <span className="mono dim">{index + 1} / {items.length}</span>}
        <span className="dim lightbox-keys">
          {many && <><kbd>←</kbd><kbd>→</kbd> step · </>}<kbd>Z</kbd> or click to zoom · <kbd>Esc</kbd> close
        </span>
        <button className="ghost" onClick={onClose}>Close</button>
      </header>

      <div className={`lightbox-stage${zoom ? ' zoomed' : ''}`} onMouseMove={zoom ? track : undefined}>
        <img
          key={item.src}
          src={item.src}
          alt={item.caption}
          draggable={false}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => {
            track(e)
            setZoom(z => !z)
          }}
          style={zoom ? { transform: 'scale(3)', transformOrigin: `${origin.x}% ${origin.y}%` } : undefined}
        />
        {many && (
          <>
            <button className="lightbox-nav prev" onMouseDown={e => e.stopPropagation()} onClick={() => setIndex(i => (i - 1 + items.length) % items.length)}>‹</button>
            <button className="lightbox-nav next" onMouseDown={e => e.stopPropagation()} onClick={() => setIndex(i => (i + 1) % items.length)}>›</button>
          </>
        )}
      </div>

      {many && (
        <div className="lightbox-strip" onMouseDown={e => e.stopPropagation()}>
          {items.map((it, i) => (
            <button key={`${it.src}-${i}`} className={i === index ? 'on' : ''} onClick={() => setIndex(i)} title={it.caption}>
              <img src={it.src} alt="" draggable={false} loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
