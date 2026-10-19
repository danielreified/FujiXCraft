import {
  DR_LABELS, EFFECT_LABELS, FILM_SIM_LABELS, GRAIN_LABELS, MONOCHROME_SIMS, NUMERIC_RANGES, WBMode, WB_LABELS,
  type Recipe, type RecipeKey, type RecipeValues,
} from '../../shared/recipe.ts'
import type { ReactNode } from 'react'
import { Segmented, Select, Slider } from './ui.tsx'

const TONES: RecipeKey[] = ['highlightTone', 'shadowTone', 'color', 'sharpness', 'noiseReduction', 'clarity']

export function Editor({ recipe, values, dirty, onChange, onSave, onSaveAs, onRevert, onDelete, onAddToSlot, headerExtra }: {
  recipe: Recipe
  values: Partial<RecipeValues>
  dirty: boolean
  onChange: (key: RecipeKey, value: number | undefined) => void
  onSave: () => void
  onSaveAs: () => void
  onRevert: () => void
  onDelete: () => void
  onAddToSlot: () => void
  headerExtra?: ReactNode
}) {
  const mono = values.filmSimulation !== undefined && MONOCHROME_SIMS.has(values.filmSimulation)
  const kelvin = values.whiteBalance === WBMode.ColorTemp
  const numeric = (key: RecipeKey) => {
    const r = NUMERIC_RANGES[key]!
    return <Slider key={key} label={r.label} value={values[key]} min={r.min} max={r.max} step={r.step} onChange={v => onChange(key, v)} />
  }

  return (
    <aside className="editor">
      <header className="editor-head">
        <div className="eyebrow">
          {recipe.meta ? 'Fuji X Weekly · fixed' : recipe.id.startsWith('slot-') ? 'On your camera' : recipe.builtIn ? 'Built-in · fixed' : 'Your recipe'}
          {dirty ? (recipe.builtIn ? ' · edits are a draft, save as your own' : ' · edited') : ''}
        </div>
        <h2>{recipe.name}{dirty ? ' *' : ''}</h2>
        {recipe.notes && <p className="note">{recipe.notes}</p>}
        {recipe.source && <a className="source" href={recipe.source} target="_blank" rel="noreferrer">Fuji X Weekly ↗</a>}
        {headerExtra && <div className="editor-extra">{headerExtra}</div>}
      </header>

      <div className="editor-scroll">
        <section>
          <h3>Film</h3>
          <Select label="Film Simulation" value={values.filmSimulation} options={FILM_SIM_LABELS} onChange={v => onChange('filmSimulation', v)} />
          <Select label="Dynamic Range" value={values.dynamicRange} options={DR_LABELS} onChange={v => onChange('dynamicRange', v)} />
          <Select label="Grain" value={values.grainEffect} options={GRAIN_LABELS} onChange={v => onChange('grainEffect', v)} />
          <Segmented label="Color Chrome" value={values.colorChrome} options={EFFECT_LABELS} onChange={v => onChange('colorChrome', v)} />
          <Segmented label="Color Chrome FX Blue" value={values.colorChromeFxBlue} options={EFFECT_LABELS} onChange={v => onChange('colorChromeFxBlue', v)} />
          <Segmented label="Smooth Skin" value={values.smoothSkin} options={EFFECT_LABELS} onChange={v => onChange('smoothSkin', v)} />
        </section>

        <section>
          <h3>White Balance</h3>
          <Select label="Mode" value={values.whiteBalance} options={WB_LABELS} onChange={v => onChange('whiteBalance', v)} />
          {kelvin && (
            <Slider label="Kelvin" value={values.wbColorTemp ?? 6500} min={2500} max={10000} step={10}
              format={v => `${v}K`} onChange={v => onChange('wbColorTemp', v ?? 6500)} />
          )}
          {numeric('wbShiftR')}
          {numeric('wbShiftB')}
        </section>

        <section>
          <h3>Tone</h3>
          {TONES.filter(k => !(mono && k === 'color')).map(numeric)}
          {numeric('exposure')}
        </section>
      </div>

      <footer className="editor-foot">
        {dirty && <button className="ghost" onClick={onRevert}>Revert</button>}
        {!recipe.builtIn && <button className="ghost danger" onClick={onDelete}>Delete</button>}
        <span className="spacer" />
        <button className="ghost" title="Stage this recipe for a C1–C7 slot" onClick={onAddToSlot}>Add to slot…</button>
        {!recipe.builtIn && dirty && <button onClick={onSave}>Save</button>}
        <button className={recipe.builtIn || !dirty ? '' : 'ghost'} onClick={onSaveAs}>Save as new…</button>
      </footer>
    </aside>
  )
}
