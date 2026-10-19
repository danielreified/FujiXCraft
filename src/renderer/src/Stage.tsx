import { useEffect, useState } from 'react'
import type { RenderResult } from '../../shared/api.ts'
import type { Recipe } from '../../shared/recipe.ts'
import { ExpandButton, useLightbox } from './Lightbox.tsx'
import { Spinner } from './ui.tsx'

export type RenderState =
  | { status: 'pending'; previous?: RenderResult }
  | { status: 'done'; result: RenderResult }
  | { status: 'error'; message: string }

export function timingLabel(r: RenderResult): string {
  if (r.cached) return 'cached'
  if (!r.timings) return ''
  return `${r.timings.total.toFixed(1)}s · camera ${r.timings.camera.toFixed(1)}s`
}

/** The image to show for a render: the finished one, or the previous one while re-rendering. */
function shown(state: RenderState | undefined): RenderResult | undefined {
  if (!state) return undefined
  if (state.status === 'done') return state.result
  if (state.status === 'pending') return state.previous
  return undefined
}

export function SingleView({ recipe, state, asShot }: {
  recipe: Recipe
  state: RenderState | undefined
  asShot: RenderState | undefined
}) {
  const [original, setOriginal] = useState(false)
  const lightbox = useLightbox()

  // Hold backslash to see the as-shot render, like LightCraft's Show Original.
  useEffect(() => {
    const down = (e: KeyboardEvent) => e.key === '\\' && !(e.target instanceof HTMLInputElement) && setOriginal(true)
    const up = (e: KeyboardEvent) => e.key === '\\' && setOriginal(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const current = shown(original ? asShot : state)
  const done = state?.status === 'done' ? state.result : undefined
  const asShotDone = asShot?.status === 'done' ? asShot.result : undefined
  const expand = () => {
    if (!done) return
    const items = [{ src: done.viewUrl, caption: recipe.name, detail: timingLabel(done) }]
    // Include the as-shot render so ←/→ flips between the two.
    if (asShotDone && asShotDone.key !== done.key) items.push({ src: asShotDone.viewUrl, caption: 'As shot', detail: '' })
    lightbox(items)
  }

  return (
    <div className="single">
      <div className="frame has-expand" onDoubleClick={expand}>
        {current ? <img src={current.viewUrl} alt={recipe.name} draggable={false} /> : <div className="frame-empty" />}
        {done && <ExpandButton onClick={expand} />}
        {state?.status === 'pending' && !original && <div className="frame-busy"><Spinner /> Rendering on camera…</div>}
        {state?.status === 'error' && <div className="frame-error">{state.message}</div>}
      </div>
      <div className="single-bar">
        <span className="single-name">{original ? 'As shot' : recipe.name}</span>
        {done && !original && <span className="chip mono">{timingLabel(done)}</span>}
        {done?.note && !original && <span className="chip warn" title={done.note}>DR limited by ISO</span>}
        <span className="spacer" />
        <button
          className="ghost hold"
          onMouseDown={() => setOriginal(true)}
          onMouseUp={() => setOriginal(false)}
          onMouseLeave={() => setOriginal(false)}
        >
          Hold for as shot <kbd>\</kbd>
        </button>
      </div>
    </div>
  )
}
