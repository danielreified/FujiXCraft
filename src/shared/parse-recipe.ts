/**
 * Parse recipe text as copied from Fuji X Weekly, e.g.
 *
 *   Film Simulation: Classic Negative
 *   Grain Effect: Weak, Small
 *   White Balance: Daylight, 0 Red & -1 Blue
 *   Highlight: -1
 *
 * Adapted from FilmKit's parse-text-preset.ts
 * (MIT License, Copyright (c) 2026 eggricesoy, github.com/eggricesoy/filmkit).
 */

import { FilmSim, Grain, WBMode, type RecipeKey, type RecipeValues } from './recipe.ts'

export interface ParseResult {
  values: Partial<RecipeValues>
  recognized: string[]
  unrecognized: string[]
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

const SIM_ALIASES: Record<string, number> = {
  provia: FilmSim.Provia, proviastandard: FilmSim.Provia, standard: FilmSim.Provia,
  velvia: FilmSim.Velvia, velviavivid: FilmSim.Velvia, vivid: FilmSim.Velvia,
  astia: FilmSim.Astia, astiasoft: FilmSim.Astia, soft: FilmSim.Astia,
  classicchrome: FilmSim.ClassicChrome,
  classicnegative: FilmSim.ClassicNeg, classicneg: FilmSim.ClassicNeg,
  proneghi: FilmSim.ProNegHi, pronegativehi: FilmSim.ProNegHi,
  pronegstd: FilmSim.ProNegStd, pronegativestd: FilmSim.ProNegStd, pronegstandard: FilmSim.ProNegStd,
  eterna: FilmSim.Eterna, eternacinema: FilmSim.Eterna,
  eternableachbypass: FilmSim.EternaBleach, bleachbypass: FilmSim.EternaBleach,
  acros: FilmSim.Acros,
  acrosye: FilmSim.AcrosYe, acrosyellow: FilmSim.AcrosYe, acrosyellowfilter: FilmSim.AcrosYe, acrosy: FilmSim.AcrosYe,
  acrosr: FilmSim.AcrosR, acrosred: FilmSim.AcrosR, acrosredfilter: FilmSim.AcrosR,
  acrosg: FilmSim.AcrosG, acrosgreen: FilmSim.AcrosG, acrosgreenfilter: FilmSim.AcrosG,
  monochrome: FilmSim.Monochrome,
  monochromeye: FilmSim.MonochromeYe, monochromeyellow: FilmSim.MonochromeYe, monochromeyellowfilter: FilmSim.MonochromeYe,
  monochromer: FilmSim.MonochromeR, monochromered: FilmSim.MonochromeR, monochromeredfilter: FilmSim.MonochromeR,
  monochromeg: FilmSim.MonochromeG, monochromegreen: FilmSim.MonochromeG, monochromegreenfilter: FilmSim.MonochromeG,
  sepia: FilmSim.Sepia,
  nostalgicneg: FilmSim.NostalgicNeg, nostalgicnegative: FilmSim.NostalgicNeg,
  realaace: FilmSim.RealaAce,
}

const WB_ALIASES: Record<string, number> = {
  auto: WBMode.Auto, autowhitepriority: WBMode.Auto, autoambiencepriority: WBMode.Auto,
  daylight: WBMode.Daylight, sunny: WBMode.Daylight, fineweather: WBMode.Daylight,
  shade: WBMode.Shade, cloudy: WBMode.Shade,
  incandescent: WBMode.Incandescent, tungsten: WBMode.Incandescent,
  fluorescent: WBMode.Fluorescent1, fluorescent1: WBMode.Fluorescent1,
  fluorescent2: WBMode.Fluorescent2, fluorescent3: WBMode.Fluorescent3,
  underwater: WBMode.Underwater,
}

type Parser = (value: string) => Partial<RecipeValues> | null

const parseSim: Parser = value => {
  const sim = SIM_ALIASES[norm(value.replace(/\(.*?\)/g, ''))] ?? SIM_ALIASES[norm(value)]
  return sim !== undefined ? { filmSimulation: sim } : null
}

const parseWB: Parser = value => {
  const out: Partial<RecipeValues> = {}
  const kelvin = value.match(/(\d{4,5})\s*K\b/i)
  if (kelvin) {
    out.whiteBalance = WBMode.ColorTemp
    out.wbColorTemp = Number(kelvin[1])
  } else {
    const mode = WB_ALIASES[norm(value.split(',')[0])]
    if (mode !== undefined) out.whiteBalance = mode
  }
  const shift = value.match(/([+-]?\d+)\s*Red\s*[&,]\s*([+-]?\d+)\s*Blue/i)
  if (shift) {
    out.wbShiftR = Number(shift[1])
    out.wbShiftB = Number(shift[2])
  }
  return Object.keys(out).length ? out : null
}

/** DR-Auto is left unset, so the RAF's own value is used. */
const parseDR: Parser = value => {
  const v = value.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (v.endsWith('100')) return { dynamicRange: 1 }
  if (v.endsWith('200')) return { dynamicRange: 2 }
  if (v.endsWith('400')) return { dynamicRange: 3 }
  if (v.includes('AUTO')) return {}
  return null
}

const parseGrain: Parser = value => {
  const v = value.toLowerCase()
  if (/\boff\b/.test(v)) return { grainEffect: Grain.Off }
  const strength = v.match(/\b(weak|strong)\b/)?.[1]
  if (!strength) return null
  const large = /\blarge\b/.test(v)
  if (strength === 'weak') return { grainEffect: large ? Grain.WeakLarge : Grain.WeakSmall }
  return { grainEffect: large ? Grain.StrongLarge : Grain.StrongSmall }
}

const effect = (key: RecipeKey): Parser => value => {
  const v = value.toLowerCase().trim()
  const i = v.startsWith('off') ? 0 : v.startsWith('weak') ? 1 : v.startsWith('strong') ? 2 : -1
  return i < 0 ? null : { [key]: i }
}

const numeric = (key: RecipeKey): Parser => value => {
  const n = parseFloat(value.replace('−', '-'))
  return Number.isFinite(n) ? { [key]: n } : null
}

/** "+1/3 to +2/3" takes the last value; "+2/3" becomes 0.667. */
const parseExposure: Parser = value => {
  const parts = value.replace(/\(.*?\)/g, '').replace(/ev/i, '').split(/\s+to\s+/i)
  const last = parts[parts.length - 1].trim().replace('−', '-')
  const frac = last.match(/^([+-]?\d+)\s*\/\s*(\d+)$/)
  const n = frac ? Number(frac[1]) / Number(frac[2]) : parseFloat(last)
  return Number.isFinite(n) ? { exposure: Math.round(n * 3) / 3 } : null
}

// Order matters: more specific labels come first.
const LABELS: [RegExp, Parser | null][] = [
  [/^film\s*sim(?:ulation)?\s*[:=-]?\s*(.+)$/i, parseSim],
  [/^colou?r\s*chrome\s*(?:effect\s*)?(?:fx\s*)?blue\s*[:=-]?\s*(.+)$/i, effect('colorChromeFxBlue')],
  [/^colou?r\s*chrome(?:\s*effect)?\s*[:=-]?\s*(.+)$/i, effect('colorChrome')],
  [/^(?:d\s*range\s*priority|dynamic\s*range\s*priority)\s*[:=-]?\s*(.+)$/i, null],
  [/^(?:dynamic\s*range|dr)\s*[:=-]?\s*(.+)$/i, parseDR],
  [/^grain(?:\s*effect)?\s*[:=-]?\s*(.+)$/i, parseGrain],
  [/^smooth\s*skin(?:\s*effect)?\s*[:=-]?\s*(.+)$/i, effect('smoothSkin')],
  [/^(?:white\s*balance|wb|kelvin)\s*[:=-]?\s*(.+)$/i, parseWB],
  [/^highlights?(?:\s*tone)?\s*[:=-]?\s*(.+)$/i, numeric('highlightTone')],
  [/^shadows?(?:\s*tone)?\s*[:=-]?\s*(.+)$/i, numeric('shadowTone')],
  [/^colou?r(?!\s*chrome)\s*[:=-]?\s*(.+)$/i, numeric('color')],
  [/^(?:sharpness|sharpening)\s*[:=-]?\s*(.+)$/i, numeric('sharpness')],
  [/^(?:high\s*iso\s*(?:noise\s*reduction|nr)|noise\s*reduction(?:\/high\s*iso\s*nr)?|nr)\s*[:=-]?\s*(.+)$/i, numeric('noiseReduction')],
  [/^clarity\s*[:=-]?\s*(.+)$/i, numeric('clarity')],
  [/^(?:exposure(?:\s*compensation)?|ev)\s*[:=-]?\s*(.+)$/i, parseExposure],
  [/^(?:iso|toning|monochromatic\s*colou?r|mono(?:chrome)?\s*colou?r)\b.*$/i, null],
]

export function parseRecipeText(text: string): ParseResult {
  const values: Partial<RecipeValues> = {}
  const recognized: string[] = []
  const unrecognized: string[] = []

  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^[-•*]\s*/, '')
    if (!line) continue
    const hit = LABELS.find(([re]) => re.test(line))
    if (!hit) {
      unrecognized.push(line)
      continue
    }
    const [re, parser] = hit
    if (!parser) {
      recognized.push(line)
      continue
    }
    const parsed = parser(line.match(re)![1].trim())
    if (parsed) {
      Object.assign(values, parsed)
      recognized.push(line)
    } else {
      unrecognized.push(line)
    }
  }
  return { values, recognized, unrecognized }
}
