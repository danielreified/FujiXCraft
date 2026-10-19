/**
 * The camera's custom setting slots (C1–C7), over USB.
 *
 * D18C selects the slot; D18D is its name and D18E–D1A5 its settings.
 * Property IDs, encodings and write order follow FilmKit's preset code
 * (MIT License, Copyright (c) 2026 eggricesoy, github.com/eggricesoy/filmkit),
 * with the X100V differences found by reading this camera's slots:
 * grain "Off" is stored as 6 and DR-Auto as 0xFFFF.
 */

import { Grain, MONOCHROME_SIMS, WBMode, type RecipeValues } from '../../shared/recipe.ts'
import type { SlotData } from '../../shared/api.ts'
import { PTPOp, PTPResp, type USBTransport, respName } from './transport.ts'

export const SLOT_COUNT = 7

const P = {
  Select: 0xd18c,
  Name: 0xd18d,
  DynamicRange: 0xd190,
  FilmSimulation: 0xd192,
  Grain: 0xd195,
  ColorChrome: 0xd196,
  ColorChromeBlue: 0xd197,
  SmoothSkin: 0xd198,
  WhiteBalance: 0xd199,
  WBShiftR: 0xd19a,
  WBShiftB: 0xd19b,
  WBColorTemp: 0xd19c,
  Highlight: 0xd19d,
  Shadow: 0xd19e,
  Color: 0xd19f,
  Sharpness: 0xd1a0,
  NoiseReduction: 0xd1a1,
  Clarity: 0xd1a2,
} as const

/** Every property a slot holds; all of them are saved for undo. */
const SLOT_PROPS = Array.from({ length: 0xd1a5 - 0xd18e + 1 }, (_, i) => 0xd18e + i)

const NAME_MAX = 25
const DR_AUTO = 0xffff
const GRAIN_OFF_X100V = 6

const GRAIN_TO_SLOT: Record<number, number> = {
  [Grain.Off]: GRAIN_OFF_X100V,
  [Grain.WeakSmall]: 2,
  [Grain.StrongSmall]: 3,
  [Grain.WeakLarge]: 4,
  [Grain.StrongLarge]: 5,
}
const SLOT_TO_GRAIN: Record<number, number> = {
  1: Grain.Off,
  [GRAIN_OFF_X100V]: Grain.Off,
  2: Grain.WeakSmall,
  3: Grain.StrongSmall,
  4: Grain.WeakLarge,
  5: Grain.StrongLarge,
}
const NR_ENCODE: Record<number, number> = {
  [-4]: 0x8000, [-3]: 0x7000, [-2]: 0x4000, [-1]: 0x3000,
  [0]: 0x2000, [1]: 0x1000, [2]: 0x0000, [3]: 0x6000, [4]: 0x5000,
}
const NR_DECODE = Object.fromEntries(Object.entries(NR_ENCODE).map(([k, v]) => [v, Number(k)])) as Record<number, number>
const DR_TO_SLOT: Record<number, number> = { 1: 100, 2: 200, 3: 400 }
const SLOT_TO_DR: Record<number, number> = { 100: 1, 200: 2, 400: 3 }

const u16 = (n: number) => {
  const b = new Uint8Array(2)
  new DataView(b.buffer).setUint16(0, n & 0xffff, true)
  return b
}
const i16 = (n: number) => {
  const b = new Uint8Array(2)
  new DataView(b.buffer).setInt16(0, Math.round(n), true)
  return b
}
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')
const unhex = (s: string) => new Uint8Array(Buffer.from(s, 'hex'))

function ptpString(s: string): Uint8Array {
  if (!s) return new Uint8Array([0])
  const out = new Uint8Array(1 + (s.length + 1) * 2)
  out[0] = s.length + 1
  for (let i = 0; i < s.length; i++) new DataView(out.buffer).setUint16(1 + i * 2, s.charCodeAt(i), true)
  return out
}

function readPtpString(d: Uint8Array): string {
  if (!d.length) return ''
  let s = ''
  for (let i = 0; i < d[0]; i++) {
    const c = d[1 + i * 2] | (d[2 + i * 2] << 8)
    if (c) s += String.fromCharCode(c)
  }
  return s
}

/** Camera names are plain ASCII, at most 25 characters. */
export function cleanSlotName(name: string): string {
  return name.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').trim().slice(0, NAME_MAX)
}

/** Decode a slot's raw properties into recipe values. */
function decode(raw: Record<string, string>): Partial<RecipeValues> {
  const num = (p: number, signed = true) => {
    const h = raw[p.toString(16)]
    if (!h || h.length < 4) return undefined
    const v = new DataView(unhex(h).buffer)
    return signed ? v.getInt16(0, true) : v.getUint16(0, true)
  }
  const tone = (p: number) => {
    const v = num(p)
    return v === undefined || v === -32768 ? undefined : v / 10
  }
  const out: Partial<RecipeValues> = {}
  const sim = num(P.FilmSimulation, false)
  if (sim) out.filmSimulation = sim
  const dr = num(P.DynamicRange, false)
  if (dr !== undefined && SLOT_TO_DR[dr]) out.dynamicRange = SLOT_TO_DR[dr]
  const grain = num(P.Grain, false)
  if (grain !== undefined && SLOT_TO_GRAIN[grain] !== undefined) out.grainEffect = SLOT_TO_GRAIN[grain]
  const cc = num(P.ColorChrome, false)
  if (cc) out.colorChrome = cc - 1
  const ccb = num(P.ColorChromeBlue, false)
  if (ccb) out.colorChromeFxBlue = ccb - 1
  const skin = num(P.SmoothSkin, false)
  if (skin) out.smoothSkin = skin - 1
  const wb = num(P.WhiteBalance, false)
  if (wb) out.whiteBalance = wb
  out.wbShiftR = num(P.WBShiftR) ?? 0
  out.wbShiftB = num(P.WBShiftB) ?? 0
  const ct = num(P.WBColorTemp, false)
  if (out.whiteBalance === WBMode.ColorTemp && ct) out.wbColorTemp = ct
  out.highlightTone = tone(P.Highlight)
  out.shadowTone = tone(P.Shadow)
  if (!(sim && MONOCHROME_SIMS.has(sim))) out.color = tone(P.Color)
  out.sharpness = tone(P.Sharpness)
  const nr = num(P.NoiseReduction, false)
  if (nr !== undefined && NR_DECODE[nr] !== undefined) out.noiseReduction = NR_DECODE[nr]
  out.clarity = tone(P.Clarity)
  for (const k of Object.keys(out) as (keyof RecipeValues)[]) if (out[k] === undefined) delete out[k]
  return out
}

/**
 * The writes for a recipe, in the order X RAW Studio uses. A slot has no
 * "as shot", so settings the recipe leaves out get the camera's defaults.
 */
function encode(v: Partial<RecipeValues>): [number, Uint8Array][] {
  const sim = v.filmSimulation ?? 1
  const mono = MONOCHROME_SIMS.has(sim)
  const wb = v.whiteBalance ?? WBMode.Auto
  const writes: [number, Uint8Array][] = [
    [P.DynamicRange, u16(v.dynamicRange ? DR_TO_SLOT[v.dynamicRange] : DR_AUTO)],
    [P.FilmSimulation, u16(sim)],
    [P.Grain, u16(GRAIN_TO_SLOT[v.grainEffect ?? Grain.Off] ?? GRAIN_OFF_X100V)],
    [P.ColorChrome, u16((v.colorChrome ?? 0) + 1)],
    [P.ColorChromeBlue, u16((v.colorChromeFxBlue ?? 0) + 1)],
    [P.SmoothSkin, u16((v.smoothSkin ?? 0) + 1)],
    [P.WhiteBalance, u16(wb)],
  ]
  // The Kelvin value must follow the WB mode directly.
  if (wb === WBMode.ColorTemp) writes.push([P.WBColorTemp, u16(v.wbColorTemp ?? 6500)])
  writes.push(
    [P.WBShiftR, i16(v.wbShiftR ?? 0)],
    [P.WBShiftB, i16(v.wbShiftB ?? 0)],
    [P.Highlight, i16((v.highlightTone ?? 0) * 10)],
    [P.Shadow, i16((v.shadowTone ?? 0) * 10)],
  )
  if (!mono) writes.push([P.Color, i16((v.color ?? 0) * 10)])
  writes.push(
    [P.Sharpness, i16((v.sharpness ?? 0) * 10)],
    [P.NoiseReduction, u16(NR_ENCODE[v.noiseReduction ?? 0] ?? NR_ENCODE[0])],
    [P.Clarity, i16((v.clarity ?? 0) * 10)],
  )
  return writes
}

export class SlotIO {
  private t: USBTransport

  constructor(t: USBTransport) {
    this.t = t
  }

  private async get(prop: number): Promise<Uint8Array | null> {
    const r = await this.t.command(PTPOp.GetDevicePropValue, [prop])
    return r.code === PTPResp.OK ? new Uint8Array(r.data) : null
  }

  private async set(prop: number, data: Uint8Array): Promise<number> {
    return (await this.t.commandWithData(PTPOp.SetDevicePropValue, [prop], data)).code
  }

  private async select(slot: number): Promise<void> {
    const code = await this.set(P.Select, u16(slot))
    if (code !== PTPResp.OK) throw new Error(`Could not select C${slot} (${respName(code)})`)
    await new Promise(r => setTimeout(r, 100))
  }

  private async readSelected(slot: number): Promise<SlotData> {
    const nameBytes = await this.get(P.Name)
    const raw: Record<string, string> = {}
    for (const p of SLOT_PROPS) {
      const d = await this.get(p)
      if (d) raw[p.toString(16)] = hex(d)
    }
    return { slot, name: nameBytes ? readPtpString(nameBytes) : '', values: decode(raw), raw }
  }

  /** Read every slot, then put the camera's slot selection back. */
  async readAll(): Promise<SlotData[]> {
    const original = await this.get(P.Select)
    const out: SlotData[] = []
    try {
      for (let slot = 1; slot <= SLOT_COUNT; slot++) {
        await this.select(slot)
        out.push(await this.readSelected(slot))
      }
    } finally {
      if (original) await this.set(P.Select, original)
    }
    return out
  }

  /**
   * Write a recipe into a slot, then read every setting back to verify it.
   * Returns the slot as it was before (for undo) and as it is now.
   */
  async write(slot: number, name: string, values: Partial<RecipeValues>): Promise<{ before: SlotData; after: SlotData; problems: string[] }> {
    const original = await this.get(P.Select)
    try {
      await this.select(slot)
      const before = await this.readSelected(slot)
      const problems: string[] = []

      const nameCode = await this.set(P.Name, ptpString(cleanSlotName(name)))
      if (nameCode !== PTPResp.OK) throw new Error(`The camera refused the slot name (${respName(nameCode)})`)

      const writes = encode(values)
      for (const [prop, data] of writes) {
        const code = await this.set(prop, data)
        if (code !== PTPResp.OK) problems.push(`${label(prop)} was refused (${respName(code)})`)
      }

      const after = await this.readSelected(slot)
      for (const [prop, data] of writes) {
        const got = after.raw[prop.toString(16)]
        if (got !== undefined && got !== hex(data)) problems.push(`${label(prop)} reads back differently than written`)
      }
      if (after.name !== cleanSlotName(name)) problems.push('The name reads back differently than written')
      return { before, after, problems }
    } finally {
      if (original) await this.set(P.Select, original)
    }
  }

  /** Put a slot back exactly as it was, from the raw bytes saved before a write. */
  async restore(previous: SlotData): Promise<SlotData> {
    const original = await this.get(P.Select)
    try {
      await this.select(previous.slot)
      await this.set(P.Name, ptpString(previous.name))
      // Same order as a normal write, so dependent settings (WB → Kelvin) land correctly.
      const order = [P.DynamicRange, P.FilmSimulation, P.Grain, P.ColorChrome, P.ColorChromeBlue, P.SmoothSkin, P.WhiteBalance, P.WBColorTemp,
        P.WBShiftR, P.WBShiftB, P.Highlight, P.Shadow, P.Color, P.Sharpness, P.NoiseReduction, P.Clarity]
      for (const prop of order) {
        const h = previous.raw[prop.toString(16)]
        if (h) await this.set(prop, unhex(h))
      }
      return await this.readSelected(previous.slot)
    } finally {
      if (original) await this.set(P.Select, original)
    }
  }
}

function label(prop: number): string {
  const name = Object.entries(P).find(([, v]) => v === prop)?.[0] ?? `0x${prop.toString(16)}`
  return name.replace(/([a-z])([A-Z])/g, '$1 $2')
}
