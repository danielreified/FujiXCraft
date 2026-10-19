import { useEffect, useMemo, useState } from 'react'
import {
  DR_LABELS, EFFECT_LABELS, GRAIN_LABELS, WBMode, describeRecipe, fmtSigned, fxwPhotoUrl, wbLabel, type Recipe,
} from '../../shared/recipe.ts'
import { ExpandButton, useLightbox, type LightboxItem } from './Lightbox.tsx'

const photoItems = (r: Recipe): LightboxItem[] =>
  r.meta!.photos.map((p, i) => ({ src: fxwPhotoUrl(p), caption: r.name, detail: `${r.meta!.filmSimulation} · sample ${i + 1} of ${r.meta!.photos.length}` }))

type Tone = 'all' | 'color' | 'bw'

/** A star toggle. */
function Star({ on, onToggle, big }: { on: boolean; onToggle: () => void; big?: boolean }) {
  return (
    <button
      className={`star${on ? ' on' : ''}${big ? ' big' : ''}`}
      title={on ? 'Remove from your Lab recipes' : 'Add to your Lab recipes'}
      onClick={e => {
        e.stopPropagation()
        onToggle()
      }}
    >
      {on ? '★' : '☆'}
    </button>
  )
}

export function Browse({ recipes, updated, camera, stars, custom, onToggleStar, onTry, onAddToSlot }: {
  recipes: Recipe[]
  updated: string | null
  /** Connected camera model, used for the "works on my camera" filter. */
  camera: string
  stars: Set<string>
  custom: Recipe[]
  onToggleStar: (id: string) => void
  onTry: (id: string) => void
  onAddToSlot: (recipe: Recipe) => void
}) {
  const [query, setQuery] = useState('')
  const [mine, setMine] = useState(true)
  const [tone, setTone] = useState<Tone>('all')
  const [sim, setSim] = useState<string | null>(null)
  const [keyword, setKeyword] = useState<string | null>(null)
  const [starredOnly, setStarredOnly] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const lightbox = useLightbox()

  const forCamera = useMemo(() => (mine ? recipes.filter(r => r.meta?.cameras.includes(camera)) : recipes), [recipes, mine, camera])

  const sims = useMemo(() => countBy(forCamera.map(r => r.meta!.filmSimulation)), [forCamera])
  const keywords = useMemo(() => countBy(forCamera.flatMap(r => r.meta!.keywords)).slice(0, 24), [forCamera])

  const q = query.trim().toLowerCase()
  const shown = forCamera.filter(r => {
    const m = r.meta!
    if (starredOnly && !stars.has(r.id)) return false
    if (tone === 'color' && !m.isColor) return false
    if (tone === 'bw' && m.isColor) return false
    if (sim && m.filmSimulation !== sim) return false
    if (keyword && !m.keywords.includes(keyword)) return false
    if (q && !`${r.name} ${m.filmSimulation} ${m.keywords.join(' ')}`.toLowerCase().includes(q)) return false
    return true
  })

  const open = recipes.find(r => r.id === openId) ?? null

  if (!recipes.length) {
    return (
      <div className="browse-empty">
        <h2>No Fuji X Weekly library found</h2>
        <p className="dim">Recipe Lab reads the recipes the Fuji X Weekly app keeps on this Mac. Install it from the App Store and open it once, then come back.</p>
      </div>
    )
  }

  return (
    <div className="browse">
      <aside className="filters">
        <input className="search" placeholder="Search recipes, films, moods" value={query} onChange={e => setQuery(e.target.value)} />
        <label className="toggle">
          <input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} /> Works on my {camera}
        </label>
        <label className="toggle">
          <input type="checkbox" checked={starredOnly} onChange={e => setStarredOnly(e.target.checked)} /> Starred only ({stars.size})
        </label>
        <div className="segmented">
          {(['all', 'color', 'bw'] as const).map(t => (
            <button key={t} className={tone === t ? 'on' : ''} onClick={() => setTone(t)}>
              {t === 'all' ? 'All' : t === 'color' ? 'Colour' : 'B&W'}
            </button>
          ))}
        </div>

        <h4>Film simulation</h4>
        <div className="facet">
          {sims.map(([name, n]) => (
            <button key={name} className={sim === name ? 'on' : ''} onClick={() => setSim(sim === name ? null : name)}>
              <span>{name}</span>
              <span className="dim mono">{n}</span>
            </button>
          ))}
        </div>

        <h4>Mood &amp; light</h4>
        <div className="chips">
          {keywords.map(([k]) => (
            <button key={k} className={`chip-btn${keyword === k ? ' on' : ''}`} onClick={() => setKeyword(keyword === k ? null : k)}>{k}</button>
          ))}
        </div>

        {updated && <p className="fine">Library from the Fuji X Weekly app, updated {new Date(updated).toLocaleDateString()}. Open that app to refresh it. Patron-only recipes aren't included.</p>}
      </aside>

      <section className="cards-scroll">
        {custom.length > 0 && !starredOnly && (
          <>
            <div className="cards-head"><span>Your recipes</span></div>
            <div className="cards mine">
              {custom.filter(r => !q || r.name.toLowerCase().includes(q)).map(r => (
                <article key={r.id} className="card mine">
                  <div className="card-body">
                    <div className="card-name">{r.name}</div>
                    <div className="card-sub">{describeRecipe(r.values)}</div>
                    <div className="card-actions">
                      <button className="ghost" onClick={() => onTry(r.id)}>Open in Lab</button>
                      <button onClick={() => onAddToSlot(r)}>Add to slot…</button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
        <div className="cards-head">
          <span>{shown.length} Fuji X Weekly recipes</span>
        </div>
        <div className="cards">
          {shown.map(r => (
            <article key={r.id} className={`card${r.id === openId ? ' open' : ''}`} onClick={() => setOpenId(r.id)}>
              <div className="card-img has-expand" onDoubleClick={() => lightbox(photoItems(r))}>
                {r.meta!.photos[0] && <img src={fxwPhotoUrl(r.meta!.photos[0])} alt="" loading="lazy" draggable={false} />}
                <ExpandButton className="left" onClick={() => lightbox(photoItems(r))} />
                <Star on={stars.has(r.id)} onToggle={() => onToggleStar(r.id)} />
              </div>
              <div className="card-body">
                <div className="card-name">{r.name}</div>
                <div className="card-sub">{r.meta!.filmSimulation} · {r.meta!.keywords.slice(0, 3).join(', ')}</div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {open && (
        <Detail
          recipe={open}
          starred={stars.has(open.id)}
          onToggleStar={() => onToggleStar(open.id)}
          onTry={() => onTry(open.id)}
          onAddToSlot={() => onAddToSlot(open)}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}

function Detail({ recipe, starred, onToggleStar, onTry, onAddToSlot, onClose }: {
  recipe: Recipe
  starred: boolean
  onToggleStar: () => void
  onTry: () => void
  onAddToSlot: () => void
  onClose: () => void
}) {
  const m = recipe.meta!
  const [photo, setPhoto] = useState(0)
  const lightbox = useLightbox()
  useEffect(() => setPhoto(0), [recipe.id])
  const v = recipe.values

  const rows: [string, string][] = [
    ['Film Simulation', m.filmSimulation],
    ['Dynamic Range', v.dynamicRange ? DR_LABELS[v.dynamicRange] : 'DR-Auto'],
    ['Grain', v.grainEffect !== undefined ? GRAIN_LABELS[v.grainEffect] : '—'],
    ['Color Chrome', v.colorChrome !== undefined ? EFFECT_LABELS[v.colorChrome] : '—'],
    ['Color Chrome FX Blue', v.colorChromeFxBlue !== undefined ? EFFECT_LABELS[v.colorChromeFxBlue] : '—'],
    ['White Balance', v.whiteBalance === undefined ? '—'
      : `${v.whiteBalance === WBMode.ColorTemp ? `${v.wbColorTemp}K` : wbLabel(v.whiteBalance)}, ${fmtSigned(v.wbShiftR ?? 0)} R ${fmtSigned(v.wbShiftB ?? 0)} B`],
    ['Highlight', v.highlightTone !== undefined ? fmtSigned(v.highlightTone) : '—'],
    ['Shadow', v.shadowTone !== undefined ? fmtSigned(v.shadowTone) : '—'],
    ['Color', v.color !== undefined ? fmtSigned(v.color) : '—'],
    ['Sharpness', v.sharpness !== undefined ? fmtSigned(v.sharpness) : '—'],
    ['Noise Reduction', v.noiseReduction !== undefined ? fmtSigned(v.noiseReduction) : '—'],
    ['Clarity', v.clarity !== undefined ? fmtSigned(v.clarity) : '—'],
    ['ISO', m.iso ?? '—'],
    ['Exposure', m.exposure ?? '—'],
  ]

  const [allKeywords, setAllKeywords] = useState(false)
  useEffect(() => setAllKeywords(false), [recipe.id])
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  const keywords = allKeywords ? m.keywords : m.keywords.slice(0, 8)

  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside className="drawer" onMouseDown={e => e.stopPropagation()}>
        <div className="drawer-scroll">
          <div className="detail-photo has-expand" onDoubleClick={() => lightbox(photoItems(recipe), photo)}>
            {m.photos[photo] && <img src={fxwPhotoUrl(m.photos[photo])} alt="" draggable={false} />}
            <ExpandButton className="left" onClick={() => lightbox(photoItems(recipe), photo)} />
            <button className="detail-close" onClick={onClose} title="Close (Esc)">✕</button>
          </div>
          {m.photos.length > 1 && (
            <div className="thumbs">
              {m.photos.map((p, i) => (
                <button key={p} className={i === photo ? 'on' : ''} onClick={() => setPhoto(i)} onMouseEnter={() => setPhoto(i)}>
                  <img src={fxwPhotoUrl(p)} alt="" loading="lazy" draggable={false} />
                </button>
              ))}
            </div>
          )}
          <div className="drawer-body">
            <div className="drawer-title">
              <div className="drawer-title-text">
                <div className="eyebrow">{m.filmSimulation} · {m.sensor}</div>
                <h2>{recipe.name}</h2>
                <div className="dim">Published {m.date}{recipe.source && <> · <a className="source" href={recipe.source} target="_blank" rel="noreferrer">Fuji X Weekly ↗</a></>}</div>
              </div>
              <button className={`star-pill${starred ? ' on' : ''}`} onClick={onToggleStar}>
                {starred ? '★ Starred' : '☆ Star'}
              </button>
            </div>

            <div className="chips">
              {keywords.map(k => <span key={k} className="chip">{k}</span>)}
              {m.keywords.length > 8 && (
                <button className="chip-btn" onClick={() => setAllKeywords(x => !x)}>{allKeywords ? 'Less' : `+${m.keywords.length - 8} more`}</button>
              )}
            </div>

            {m.unsupported.length > 0 && <p className="warn-text">Not sent to the camera yet: {m.unsupported.join(', ')}.</p>}

            <div className="setting-tiles">
              {rows.map(([k, val]) => (
                <div key={k} className={`setting-tile${val === '—' ? ' none' : ''}${k === 'White Balance' || k === 'Film Simulation' ? ' wide' : ''}`}>
                  <span className="setting-label">{k}</span>
                  <span className="setting-value">{val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <footer className="drawer-foot">
          <button className="ghost" onClick={onAddToSlot}>Add to slot…</button>
          <button onClick={onTry}>Try it on my RAW</button>
        </footer>
      </aside>
    </div>
  )
}

function countBy(items: string[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}
