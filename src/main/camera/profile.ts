/**
 * Patch the camera's native RAW conversion profile (property 0xD185).
 *
 * Only fields the recipe sets are overwritten. Untouched fields keep the
 * camera's sentinel values, so it falls back to what the RAF recorded.
 *
 * Field indices and encodings come from FilmKit's d185.ts
 * (MIT License, Copyright (c) 2026 eggricesoy, github.com/eggricesoy/filmkit).
 */

import { Grain, MONOCHROME_SIMS, type RecipeValues } from '../../shared/recipe.ts'

/** Output container: field 2 of the profile. */
export const OutputFormat = { JPEG: 7, TIFF8: 9, TIFF16: 11 } as const

const Idx = {
  FileType: 2,
  ExposureBias: 4,
  DynamicRange: 6,
  FilmSimulation: 8,
  GrainEffect: 9,
  ColorChrome: 10,
  SmoothSkin: 11,
  WhiteBalance: 12,
  WBShiftR: 13,
  WBShiftB: 14,
  WBColorTemp: 15,
  HighlightTone: 16,
  ShadowTone: 17,
  Color: 18,
  Sharpness: 19,
  NoiseReduction: 20,
  CCFxBlue: 25,
  Clarity: 27,
} as const

/** Grain (strength | size << 8) → the profile's flat enum. */
const GRAIN_NATIVE: Record<number, number> = {
  [Grain.Off]: 1,
  [Grain.WeakSmall]: 2,
  [Grain.StrongSmall]: 3,
  [Grain.WeakLarge]: 4,
  [Grain.StrongLarge]: 5,
}

const DR_NATIVE: Record<number, number> = { 1: 100, 2: 200, 3: 400 }

/** Noise reduction uses a non-linear proprietary encoding. */
const NR_NATIVE: Record<number, number> = {
  [-4]: 0x8000, [-3]: 0x7000, [-2]: 0x4000, [-1]: 0x3000,
  [0]: 0x2000, [1]: 0x1000, [2]: 0x0000, [3]: 0x6000, [4]: 0x5000,
}

export function patchProfile(base: Uint8Array, v: Partial<RecipeValues>, fileType: number = OutputFormat.JPEG): Uint8Array {
  const out = new Uint8Array(base)
  const view = new DataView(out.buffer)
  const numParams = view.getUint16(0, true)
  const fieldsStart = out.length - numParams * 4
  const set = (idx: number, value: number) => view.setInt32(fieldsStart + idx * 4, Math.round(value), true)

  set(Idx.FileType, fileType)

  const sim = v.filmSimulation
  if (sim !== undefined) set(Idx.FilmSimulation, sim)
  if (v.exposure !== undefined) set(Idx.ExposureBias, v.exposure * 1000)
  if (v.dynamicRange !== undefined && DR_NATIVE[v.dynamicRange]) set(Idx.DynamicRange, DR_NATIVE[v.dynamicRange])
  if (v.grainEffect !== undefined) set(Idx.GrainEffect, GRAIN_NATIVE[v.grainEffect] ?? 1)

  // Off / Weak / Strong are 1-indexed in the profile.
  if (v.colorChrome !== undefined) set(Idx.ColorChrome, v.colorChrome + 1)
  if (v.colorChromeFxBlue !== undefined) set(Idx.CCFxBlue, v.colorChromeFxBlue + 1)
  if (v.smoothSkin !== undefined) set(Idx.SmoothSkin, v.smoothSkin + 1)

  if (v.whiteBalance !== undefined) set(Idx.WhiteBalance, v.whiteBalance)
  if (v.wbShiftR !== undefined) set(Idx.WBShiftR, v.wbShiftR)
  if (v.wbShiftB !== undefined) set(Idx.WBShiftB, v.wbShiftB)
  if (v.wbColorTemp !== undefined) set(Idx.WBColorTemp, v.wbColorTemp)

  // Tone settings are stored ×10, which allows half steps.
  if (v.highlightTone !== undefined) set(Idx.HighlightTone, v.highlightTone * 10)
  if (v.shadowTone !== undefined) set(Idx.ShadowTone, v.shadowTone * 10)
  // Monochrome sims have no Color setting.
  if (v.color !== undefined && !(sim !== undefined && MONOCHROME_SIMS.has(sim))) set(Idx.Color, v.color * 10)
  if (v.sharpness !== undefined) set(Idx.Sharpness, v.sharpness * 10)
  if (v.noiseReduction !== undefined && NR_NATIVE[v.noiseReduction] !== undefined) set(Idx.NoiseReduction, NR_NATIVE[v.noiseReduction])
  if (v.clarity !== undefined) set(Idx.Clarity, v.clarity * 10)

  return out
}
