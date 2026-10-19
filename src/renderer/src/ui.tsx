import type { ReactNode } from 'react'
import { fmtSigned } from '../../shared/recipe.ts'

/** A setting row. `unset` settings render "As shot" and offer no reset. */
function Row({ label, value, unset, onReset, children }: {
  label: string
  value?: ReactNode
  unset: boolean
  onReset: () => void
  children: ReactNode
}) {
  return (
    <div className={`field${unset ? ' unset' : ''}`}>
      <div className="field-head">
        <span className="field-label">{label}</span>
        <span className="field-value">{unset ? 'As shot' : value}</span>
        <button className="reset" title="Back to as shot" disabled={unset} onClick={onReset}>↺</button>
      </div>
      {children}
    </div>
  )
}

export function Slider({ label, value, min, max, step, onChange, format = fmtSigned }: {
  label: string
  value: number | undefined
  min: number
  max: number
  step: number
  onChange: (v: number | undefined) => void
  format?: (v: number) => string
}) {
  const unset = value === undefined
  const v = value ?? 0
  const pct = ((v - min) / (max - min)) * 100
  const zero = ((0 - min) / (max - min)) * 100
  return (
    <Row label={label} value={format(v)} unset={unset} onReset={() => onChange(undefined)}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        style={{ '--fill-from': `${Math.min(pct, zero)}%`, '--fill-to': `${Math.max(pct, zero)}%` } as React.CSSProperties}
        onChange={e => onChange(Math.round(Number(e.target.value) * 1000) / 1000)}
        onDoubleClick={() => onChange(undefined)}
      />
    </Row>
  )
}

export function Select({ label, value, options, onChange }: {
  label: string
  value: number | undefined
  options: Record<number, string>
  onChange: (v: number | undefined) => void
}) {
  const unset = value === undefined
  return (
    <Row label={label} unset={unset} onReset={() => onChange(undefined)}>
      <select value={unset ? '' : String(value)} onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))}>
        <option value="">As shot</option>
        {Object.entries(options).map(([k, name]) => (
          <option key={k} value={k}>{name}</option>
        ))}
      </select>
    </Row>
  )
}

export function Segmented({ label, value, options, onChange }: {
  label: string
  value: number | undefined
  options: readonly string[]
  onChange: (v: number | undefined) => void
}) {
  const unset = value === undefined
  return (
    <Row label={label} unset={unset} onReset={() => onChange(undefined)}>
      <div className="segmented">
        {options.map((name, i) => (
          <button key={name} className={value === i ? 'on' : ''} onClick={() => onChange(value === i ? undefined : i)}>
            {name}
          </button>
        ))}
      </div>
    </Row>
  )
}

export function Spinner() {
  return <span className="spinner" aria-label="Rendering" />
}
