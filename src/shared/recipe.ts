/**
 * Recipe model shared by the main process and the UI.
 *
 * A recipe only lists the settings it changes. Anything left out is rendered
 * "as shot", using the value the camera recorded in the RAF.
 *
 * Enum codes follow FilmKit (MIT, github.com/eggricesoy/filmkit), which
 * confirmed them against X100V and X100VI USB captures.
 */

export const FilmSim = {
  Provia: 0x01,
  Velvia: 0x02,
  Astia: 0x03,
  ProNegHi: 0x04,
  ProNegStd: 0x05,
  Monochrome: 0x06,
  MonochromeYe: 0x07,
  MonochromeR: 0x08,
  MonochromeG: 0x09,
  Sepia: 0x0a,
  ClassicChrome: 0x0b,
  Acros: 0x0c,
  AcrosYe: 0x0d,
  AcrosR: 0x0e,
  AcrosG: 0x0f,
  Eterna: 0x10,
  ClassicNeg: 0x11,
  EternaBleach: 0x12,
  NostalgicNeg: 0x13,
  RealaAce: 0x14,
} as const

export const FILM_SIM_LABELS: Record<number, string> = {
  [FilmSim.Provia]: 'Provia',
  [FilmSim.Velvia]: 'Velvia',
  [FilmSim.Astia]: 'Astia',
  [FilmSim.ClassicChrome]: 'Classic Chrome',
  [FilmSim.ClassicNeg]: 'Classic Negative',
  [FilmSim.ProNegHi]: 'PRO Neg. Hi',
  [FilmSim.ProNegStd]: 'PRO Neg. Std',
  [FilmSim.Eterna]: 'Eterna',
  [FilmSim.EternaBleach]: 'Eterna Bleach Bypass',
  [FilmSim.Acros]: 'Acros',
  [FilmSim.AcrosYe]: 'Acros + Ye',
  [FilmSim.AcrosR]: 'Acros + R',
  [FilmSim.AcrosG]: 'Acros + G',
  [FilmSim.Monochrome]: 'Monochrome',
  [FilmSim.MonochromeYe]: 'Monochrome + Ye',
  [FilmSim.MonochromeR]: 'Monochrome + R',
  [FilmSim.MonochromeG]: 'Monochrome + G',
  [FilmSim.Sepia]: 'Sepia',
  [FilmSim.NostalgicNeg]: 'Nostalgic Neg. (X-Trans V)',
  [FilmSim.RealaAce]: 'Reala Ace (X-Trans V)',
}

export const MONOCHROME_SIMS = new Set<number>([
  FilmSim.Monochrome, FilmSim.MonochromeYe, FilmSim.MonochromeR, FilmSim.MonochromeG,
  FilmSim.Sepia, FilmSim.Acros, FilmSim.AcrosYe, FilmSim.AcrosR, FilmSim.AcrosG,
])

export const WBMode = {
  Auto: 0x0002,
  Daylight: 0x0004,
  Incandescent: 0x0006,
  Underwater: 0x0008,
  Fluorescent1: 0x8001,
  Fluorescent2: 0x8002,
  Fluorescent3: 0x8003,
  Shade: 0x8006,
  ColorTemp: 0x8007,
} as const

export const WB_LABELS: Record<number, string> = {
  [WBMode.Auto]: 'Auto',
  [WBMode.Daylight]: 'Daylight',
  [WBMode.Shade]: 'Shade',
  [WBMode.Incandescent]: 'Incandescent',
  [WBMode.Fluorescent1]: 'Fluorescent 1',
  [WBMode.Fluorescent2]: 'Fluorescent 2',
  [WBMode.Fluorescent3]: 'Fluorescent 3',
  [WBMode.Underwater]: 'Underwater',
  [WBMode.ColorTemp]: 'Kelvin',
}

/** WB name, including codes we haven't identified (likely custom WB on the camera). */
export function wbLabel(code: number): string {
  return WB_LABELS[code] ?? `Other WB (0x${code.toString(16)})`
}

/** Grain: low byte = strength (0 off, 2 weak, 3 strong), high byte = size (0 small, 1 large). */
export const Grain = {
  Off: 0x0000,
  WeakSmall: 0x0002,
  StrongSmall: 0x0003,
  WeakLarge: 0x0102,
  StrongLarge: 0x0103,
} as const

export const GRAIN_LABELS: Record<number, string> = {
  [Grain.Off]: 'Off',
  [Grain.WeakSmall]: 'Weak, Small',
  [Grain.StrongSmall]: 'Strong, Small',
  [Grain.WeakLarge]: 'Weak, Large',
  [Grain.StrongLarge]: 'Strong, Large',
}

/** Off / Weak / Strong effects (Color Chrome, FX Blue, Smooth Skin). */
export const EFFECT_LABELS = ['Off', 'Weak', 'Strong'] as const

/** Dynamic range: 1 = DR100, 2 = DR200, 3 = DR400. */
export const DR_LABELS: Record<number, string> = { 1: 'DR100', 2: 'DR200', 3: 'DR400' }

export interface RecipeValues {
  filmSimulation: number
  dynamicRange: number
  grainEffect: number
  colorChrome: number
  colorChromeFxBlue: number
  smoothSkin: number
  whiteBalance: number
  wbColorTemp: number
  wbShiftR: number
  wbShiftB: number
  highlightTone: number
  shadowTone: number
  color: number
  sharpness: number
  noiseReduction: number
  clarity: number
  /** Exposure compensation in EV. */
  exposure: number
}

export type RecipeKey = keyof RecipeValues

/** Extra details for recipes from the Fuji X Weekly library. */
export interface RecipeMeta {
  fxwId: string
  sensor: string
  cameras: string[]
  date: string
  isColor: boolean
  keywords: string[]
  /** Sample photo URLs; show them through the `fxw://photo/` protocol. */
  photos: string[]
  iso?: string
  exposure?: string
  /** The film simulation as FXW names it. */
  filmSimulation: string
  /** Recipe settings Recipe Lab can't send to the camera yet. */
  unsupported: string[]
}

export interface Recipe {
  id: string
  name: string
  notes?: string
  source?: string
  builtIn?: boolean
  values: Partial<RecipeValues>
  meta?: RecipeMeta
}

export const fxwPhotoUrl = (url: string) => `fxw://photo/${encodeURIComponent(url)}`

/** Slider ranges for the numeric settings, as accepted by X-Trans IV bodies. */
export const NUMERIC_RANGES: Partial<Record<RecipeKey, { min: number; max: number; step: number; label: string }>> = {
  highlightTone: { min: -2, max: 4, step: 0.5, label: 'Highlight' },
  shadowTone: { min: -2, max: 4, step: 0.5, label: 'Shadow' },
  color: { min: -4, max: 4, step: 1, label: 'Color' },
  sharpness: { min: -4, max: 4, step: 1, label: 'Sharpness' },
  noiseReduction: { min: -4, max: 4, step: 1, label: 'Noise Reduction' },
  clarity: { min: -5, max: 5, step: 1, label: 'Clarity' },
  wbShiftR: { min: -9, max: 9, step: 1, label: 'WB Shift Red' },
  wbShiftB: { min: -9, max: 9, step: 1, label: 'WB Shift Blue' },
  exposure: { min: -2, max: 3, step: 1 / 3, label: 'Exposure' },
}

/** Stable key for a recipe's rendered output, used for caching renders. */
export function recipeHash(values: Partial<RecipeValues>): string {
  const keys = Object.keys(values).sort() as RecipeKey[]
  return keys.map(k => `${k}=${values[k]}`).join('&') || 'as-shot'
}

/** One-line summary, e.g. "Classic Negative · Weak Small grain · Daylight +2R −5B". */
export function describeRecipe(v: Partial<RecipeValues>): string {
  const parts: string[] = []
  if (v.filmSimulation !== undefined) parts.push(FILM_SIM_LABELS[v.filmSimulation] ?? `Sim ${v.filmSimulation}`)
  if (v.dynamicRange !== undefined) parts.push(DR_LABELS[v.dynamicRange] ?? '')
  if (v.grainEffect !== undefined && v.grainEffect !== Grain.Off) parts.push(`Grain ${GRAIN_LABELS[v.grainEffect]}`)
  if (v.whiteBalance !== undefined) {
    const wb = v.whiteBalance === WBMode.ColorTemp ? `${v.wbColorTemp ?? 6500}K` : wbLabel(v.whiteBalance)
    const r = v.wbShiftR ?? 0
    const b = v.wbShiftB ?? 0
    parts.push(r || b ? `${wb} ${fmtSigned(r)}R ${fmtSigned(b)}B` : wb)
  }
  return parts.join(' · ') || 'As shot'
}

export function fmtSigned(n: number): string {
  const s = Number.isInteger(n) ? String(Math.abs(n)) : Math.abs(n).toFixed(1)
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : '0'
}

/** The base film simulations, as a starting point for comparing looks. */
export const BASE_SIM_RECIPES: Recipe[] = [
  FilmSim.Provia, FilmSim.Velvia, FilmSim.Astia, FilmSim.ClassicChrome, FilmSim.ClassicNeg,
  FilmSim.ProNegHi, FilmSim.ProNegStd, FilmSim.Eterna, FilmSim.EternaBleach, FilmSim.Acros,
].map(sim => ({
  id: `sim-${sim}`,
  name: FILM_SIM_LABELS[sim],
  builtIn: true,
  values: { filmSimulation: sim },
}))

/** Recipe text in Fuji X Weekly's format; the paste parser reads it back. */
export function recipeToText(name: string, v: Partial<RecipeValues>): string {
  const sign = (n: number) => (n > 0 ? `+${n}` : String(n))
  const lines = [name]
  if (v.filmSimulation !== undefined) lines.push(`Film Simulation: ${FILM_SIM_LABELS[v.filmSimulation]?.replace(/ \(.*\)/, '')}`)
  lines.push(`Dynamic Range: ${v.dynamicRange !== undefined ? DR_LABELS[v.dynamicRange] : 'DR-Auto'}`)
  if (v.highlightTone !== undefined) lines.push(`Highlight: ${sign(v.highlightTone)}`)
  if (v.shadowTone !== undefined) lines.push(`Shadow: ${sign(v.shadowTone)}`)
  if (v.color !== undefined) lines.push(`Color: ${sign(v.color)}`)
  if (v.noiseReduction !== undefined) lines.push(`Noise Reduction: ${sign(v.noiseReduction)}`)
  if (v.sharpness !== undefined) lines.push(`Sharpening: ${sign(v.sharpness)}`)
  if (v.clarity !== undefined) lines.push(`Clarity: ${sign(v.clarity)}`)
  if (v.grainEffect !== undefined) lines.push(`Grain Effect: ${GRAIN_LABELS[v.grainEffect]}`)
  if (v.colorChrome !== undefined) lines.push(`Color Chrome Effect: ${EFFECT_LABELS[v.colorChrome]}`)
  if (v.colorChromeFxBlue !== undefined) lines.push(`Color Chrome FX Blue: ${EFFECT_LABELS[v.colorChromeFxBlue]}`)
  if (v.smoothSkin !== undefined) lines.push(`Smooth Skin Effect: ${EFFECT_LABELS[v.smoothSkin]}`)
  if (v.whiteBalance !== undefined) {
    const wb = v.whiteBalance === WBMode.ColorTemp ? `${v.wbColorTemp ?? 6500}K` : WB_LABELS[v.whiteBalance]
    lines.push(`White Balance: ${wb}, ${sign(v.wbShiftR ?? 0)} Red & ${sign(v.wbShiftB ?? 0)} Blue`)
  }
  if (v.exposure !== undefined) lines.push(`Exposure Compensation: ${sign(Math.round(v.exposure * 100) / 100)}`)
  return lines.join('\n')
}

/**
 * Factory-neutral settings. With "neutral base" on, anything a recipe leaves out
 * uses these instead of whatever the RAW was shot with, so a recipe looks the
 * same on every photo (FilmKit issue #9). White balance stays Auto.
 */
export const NEUTRAL_BASE: Partial<RecipeValues> = {
  filmSimulation: FilmSim.Provia,
  dynamicRange: 1,
  grainEffect: Grain.Off,
  colorChrome: 0,
  colorChromeFxBlue: 0,
  smoothSkin: 0,
  whiteBalance: WBMode.Auto,
  wbShiftR: 0,
  wbShiftB: 0,
  highlightTone: 0,
  shadowTone: 0,
  color: 0,
  sharpness: 0,
  noiseReduction: 0,
  clarity: 0,
  exposure: 0,
}

/** A recipe on a neutral base. "As shot" (no settings at all) is left alone. */
export function onNeutralBase(values: Partial<RecipeValues>): Partial<RecipeValues> {
  if (!Object.keys(values).length) return values
  const out = { ...NEUTRAL_BASE, ...values }
  if (out.whiteBalance !== WBMode.ColorTemp) delete out.wbColorTemp
  return out
}
