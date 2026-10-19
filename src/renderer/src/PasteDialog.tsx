import { useMemo, useState } from 'react'
import { parseRecipeText } from '../../shared/parse-recipe.ts'
import { describeRecipe, type RecipeValues } from '../../shared/recipe.ts'

const EXAMPLE = `Film Simulation: Classic Negative
Dynamic Range: DR-Auto
Grain Effect: Weak, Small
Color Chrome Effect: Strong
Color Chrome FX Blue: Weak
White Balance: Daylight, 0 Red & -1 Blue
Highlight: -1
Shadow: -2
Color: +1
Sharpness: -2
Noise Reduction: -4
Clarity: -2`

/** Paste a recipe as text (e.g. copied from Fuji X Weekly), or name a new one. */
export function PasteDialog({ title, initialName, initialText, onCancel, onSave, nameNote }: {
  title: string
  initialName: string
  initialText: string
  onCancel: () => void
  onSave: (name: string, values: Partial<RecipeValues>) => void
  nameNote?: (name: string) => string | null
}) {
  const [name, setName] = useState(initialName)
  const [text, setText] = useState(initialText)
  const parsed = useMemo(() => parseRecipeText(text), [text])
  const count = Object.keys(parsed.values).length

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal" onMouseDown={e => e.stopPropagation()}>
        <h2>{title}</h2>
        <label className="modal-label">Name</label>
        <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="My recipe" />
        {nameNote?.(name) && <div className="name-note">{nameNote(name)}</div>}
        <label className="modal-label">Recipe text</label>
        <textarea value={text} onChange={e => setText(e.target.value)} placeholder={EXAMPLE} rows={13} spellCheck={false} />
        <div className="parse-summary">
          {count ? <span>{count} settings · {describeRecipe(parsed.values)}</span> : <span className="dim">Paste the settings lines from a recipe page.</span>}
          {parsed.unrecognized.length > 0 && (
            <div className="warn-text">Skipped: {parsed.unrecognized.join(' · ')}</div>
          )}
        </div>
        <div className="modal-actions">
          <button className="ghost" onClick={onCancel}>Cancel</button>
          <button disabled={!name.trim() || !count} onClick={() => onSave(name.trim(), parsed.values)}>{nameNote?.(name)?.startsWith('You already') ? 'Update recipe' : 'Save recipe'}</button>
        </div>
      </div>
    </div>
  )
}
