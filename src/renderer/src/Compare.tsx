import { useEffect, useRef, useState } from 'react'
import type { RenderResult } from '../../shared/api.ts'
import type { Recipe } from '../../shared/recipe.ts'
import type { RenderState } from './Stage.tsx'
import { timingLabel } from './Stage.tsx'
import { ExpandButton, useLightbox, type LightboxItem } from './Lightbox.tsx'
import { Spinner } from './ui.tsx'

export type CompareStyle = 'split' | 'flip' | 'grid'

/** Drop a recipe from the comparison. */
function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="compare-remove"
      title="Remove from Compare"
      onClick={e => {
        e.stopPropagation()
        onClick()
      }}
      onDoubleClick={e => e.stopPropagation()}
    >
      ✕
    </button>
  )
}

export interface CompareItem {
  recipe: Recipe
  state: RenderState | undefined
}

const done = (s: RenderState | undefined): RenderResult | undefined => (s?.status === 'done' ? s.result : undefined)

/** Finished renders as lightbox items, plus where `fromIndex` landed among them. */
function renderItems(items: CompareItem[], fromIndex = 0): [LightboxItem[], number] {
  const out: LightboxItem[] = []
  let at = 0
  items.forEach((item, i) => {
    const r = done(item.state)
    if (!r) return
    if (i === fromIndex) at = out.length
    out.push({ src: r.viewUrl, caption: item.recipe.name, detail: timingLabel(r) })
  })
  return [out, at]
}

/** Natural aspect ratio of the renders, so every layer lines up exactly. */
function useAspect(items: CompareItem[]): number {
  const [aspect, setAspect] = useState(3 / 2)
  const url = items.map(i => done(i.state)?.viewUrl).find(Boolean)
  useEffect(() => {
    if (!url) return
    const img = new Image()
    img.onload = () => img.naturalWidth && setAspect(img.naturalWidth / img.naturalHeight)
    img.src = url
  }, [url])
  return aspect
}

/** A box with the image's aspect ratio, as large as fits in the stage. */
function Canvas({ aspect, children, onMouseMove, onMouseLeave }: {
  aspect: number
  children: React.ReactNode
  onMouseMove?: (e: React.MouseEvent<HTMLDivElement>) => void
  onMouseLeave?: () => void
}) {
  return (
    <div className="canvas-wrap">
      <div className="canvas" style={{ aspectRatio: String(aspect), width: `min(100cqw, calc(100cqh * ${aspect}))` }} onMouseMove={onMouseMove} onMouseLeave={onMouseLeave}>
        {children}
      </div>
    </div>
  )
}

// ── Split: vertical strips with draggable dividers ───────────────────

function SplitView({ items, onSelect, onRemove }: { items: CompareItem[]; onSelect: (id: string) => void; onRemove: (id: string) => void }) {
  const aspect = useAspect(items)
  const n = items.length
  const [cuts, setCuts] = useState<number[]>([])
  const canvasRef = useRef<HTMLDivElement>(null)
  const ids = items.map(i => i.recipe.id).join()

  // Evenly spaced dividers whenever the set of recipes changes.
  useEffect(() => setCuts(Array.from({ length: n - 1 }, (_, i) => ((i + 1) / n) * 100)), [ids, n])

  const drag = (index: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    const rect = canvasRef.current!.getBoundingClientRect()
    const move = (ev: PointerEvent) => {
      const pct = ((ev.clientX - rect.left) / rect.width) * 100
      setCuts(prev => {
        const next = [...prev]
        const lo = index > 0 ? next[index - 1] + 1 : 0
        const hi = index < next.length - 1 ? next[index + 1] - 1 : 100
        next[index] = Math.max(lo, Math.min(hi, pct))
        return next
      })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const edges = [0, ...cuts, 100]
  const lightbox = useLightbox()
  return (
    <div className="canvas-wrap">
      <div ref={canvasRef} className="canvas has-expand" style={{ aspectRatio: String(aspect), width: `min(100cqw, calc(100cqh * ${aspect}))` }}>
        <ExpandButton className="bottom" onClick={() => lightbox(...renderItems(items))} />
        {items.map((item, i) => {
          const r = done(item.state)
          const left = edges[i]
          const right = 100 - edges[i + 1]
          return (
            <div key={item.recipe.id} className="layer" style={{ clipPath: `inset(0 ${right}% 0 ${left}%)` }}>
              {r && <img src={r.viewUrl} alt={item.recipe.name} draggable={false} />}
              {!r && <div className="layer-busy">{item.state?.status === 'error' ? 'Failed' : <Spinner />}</div>}
            </div>
          )
        })}
        {items.map((item, i) => {
          const width = edges[i + 1] - edges[i]
          if (width < 5) return null
          return (
            <div
              key={`label-${item.recipe.id}`}
              className="split-label"
              style={{ left: `${(edges[i] + edges[i + 1]) / 2}%`, maxWidth: `calc(${width}% - 10px)` }}
            >
              <button className="split-label-name" title={`${item.recipe.name}: open in the editor`} onClick={() => onSelect(item.recipe.id)}>
                {item.recipe.name}
              </button>
              <RemoveButton onClick={() => onRemove(item.recipe.id)} />
            </div>
          )
        })}
        {cuts.map((c, i) => (
          <div key={i} className="divider" style={{ left: `${c}%` }} onPointerDown={drag(i)}>
            <span className="divider-handle" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Flip: one image, swap recipes in place ───────────────────────────

function FlipView({ items, onSelect, onRemove }: { items: CompareItem[]; onSelect: (id: string) => void; onRemove: (id: string) => void }) {
  const aspect = useAspect(items)
  const [index, setIndex] = useState(0)
  const i = Math.min(index, items.length - 1)

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (/^[1-9]$/.test(e.key) && Number(e.key) <= items.length) setIndex(Number(e.key) - 1)
      if (e.key === 'ArrowRight') setIndex(x => (x + 1) % items.length)
      if (e.key === 'ArrowLeft') setIndex(x => (x - 1 + items.length) % items.length)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [items.length])

  const current = items[i]
  const lightbox = useLightbox()
  const expand = () => lightbox(...renderItems(items, i))
  return (
    <div className="flip">
      <Canvas aspect={aspect}>
        <div className="has-expand layer" onDoubleClick={expand}>
          {done(current.state) && <ExpandButton onClick={expand} />}
        </div>
        {/* Every render stays mounted so flipping is instant. */}
        {items.map((item, k) => {
          const r = done(item.state)
          return r ? <img key={item.recipe.id} className="layer-img" style={{ opacity: k === i ? 1 : 0 }} src={r.viewUrl} alt={item.recipe.name} draggable={false} /> : null
        })}
        {!done(current.state) && <div className="layer-busy"><Spinner /></div>}
        <div className="flip-name">{current.recipe.name}</div>
      </Canvas>
      <div className="flip-chips">
        {items.map((item, k) => (
          <button
            key={item.recipe.id}
            className={`flip-chip${k === i ? ' on' : ''}`}
            onMouseEnter={() => setIndex(k)}
            onClick={() => setIndex(k)}
            onDoubleClick={() => onSelect(item.recipe.id)}
          >
            <kbd>{k + 1}</kbd> {item.recipe.name}
            {!done(item.state) && <Spinner />}
            <RemoveButton onClick={() => onRemove(item.recipe.id)} />
          </button>
        ))}
      </div>
      <div className="hint">Hover the names or press <kbd>1</kbd>–<kbd>9</kbd> / <kbd>←</kbd><kbd>→</kbd> to flip. Double-click a name to edit it.</div>
    </div>
  )
}

// ── Grid: tiles with a synced zoom ───────────────────────────────────

function GridView({ items, activeId, onSelect, onRemove }: { items: CompareItem[]; activeId: string; onSelect: (id: string) => void; onRemove: (id: string) => void }) {
  const aspect = useAspect(items)
  const [zoomHeld, setZoomHeld] = useState(false)
  const [point, setPoint] = useState({ x: 50, y: 50 })

  useEffect(() => {
    const down = (e: KeyboardEvent) => e.key.toLowerCase() === 'z' && !(e.target instanceof HTMLInputElement) && setZoomHeld(true)
    const up = (e: KeyboardEvent) => e.key.toLowerCase() === 'z' && setZoomHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const cols = items.length <= 1 ? 1 : items.length <= 4 ? 2 : items.length <= 9 ? 3 : 4
  const lightbox = useLightbox()
  const track = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setPoint({ x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 })
  }

  return (
    <div className="grid-wrap">
      <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {items.map((item, i) => {
          const r = done(item.state)
          const expand = () => lightbox(...renderItems(items, i))
          return (
            <figure key={item.recipe.id} className={`tile${item.recipe.id === activeId ? ' active' : ''}`} onClick={() => onSelect(item.recipe.id)}>
              <div className="tile-img has-expand" style={{ aspectRatio: String(aspect) }} onMouseMove={track} onDoubleClick={e => { e.stopPropagation(); expand() }}>
                {r && <ExpandButton onClick={expand} />}
                {r && (
                  <img
                    src={r.viewUrl}
                    alt={item.recipe.name}
                    draggable={false}
                    style={zoomHeld ? { transform: 'scale(4)', transformOrigin: `${point.x}% ${point.y}%` } : undefined}
                  />
                )}
                {item.state?.status === 'pending' && <div className="tile-busy"><Spinner /></div>}
              </div>
              <figcaption>
                <span>{item.recipe.name}</span>
                <span className="tile-meta">
                  {r && <span className="mono dim">{timingLabel(r)}</span>}
                  <RemoveButton onClick={() => onRemove(item.recipe.id)} />
                </span>
              </figcaption>
            </figure>
          )
        })}
      </div>
      <div className="hint">Hold <kbd>Z</kbd> and move the mouse over any tile to zoom every tile to the same spot. Click a tile to edit it.</div>
    </div>
  )
}

export function CompareView({ style, items, activeId, onSelect, onRemove }: {
  style: CompareStyle
  items: CompareItem[]
  activeId: string
  onSelect: (id: string) => void
  onRemove: (id: string) => void
}) {
  if (!items.length) return <div className="empty-hint">Tick recipes in the library to compare them.</div>
  if (style === 'split') return <SplitView items={items} onSelect={onSelect} onRemove={onRemove} />
  if (style === 'flip') return <FlipView items={items} onSelect={onSelect} onRemove={onRemove} />
  return <GridView items={items} activeId={activeId} onSelect={onSelect} onRemove={onRemove} />
}
