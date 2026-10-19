/**
 * Read the few EXIF fields we need from a Fujifilm RAF.
 *
 * A RAF starts with a header whose bytes 84–87 (big-endian) point at an
 * embedded JPEG. That JPEG's APP1 segment carries standard TIFF/EXIF data.
 */

import { open } from 'node:fs/promises'

export interface RafInfo {
  iso?: number
  model?: string
}

const TAG_MODEL = 0x0110
const TAG_EXIF_IFD = 0x8769
const TAG_ISO = 0x8827

export async function readRafInfo(path: string): Promise<RafInfo> {
  const file = await open(path, 'r')
  try {
    const header = Buffer.alloc(92)
    await file.read(header, 0, header.length, 0)
    if (header.toString('latin1', 0, 16) !== 'FUJIFILMCCD-RAW ') return {}
    const jpegOffset = header.readUInt32BE(84)

    // The EXIF block sits in the first 64 KB of the embedded JPEG.
    const jpeg = Buffer.alloc(64 * 1024)
    const { bytesRead } = await file.read(jpeg, 0, jpeg.length, jpegOffset)
    return parseExif(jpeg.subarray(0, bytesRead))
  } catch {
    return {}
  } finally {
    await file.close()
  }
}

function parseExif(jpeg: Buffer): RafInfo {
  let off = 2 // skip SOI
  while (off + 4 < jpeg.length && jpeg[off] === 0xff) {
    const marker = jpeg[off + 1]
    const len = jpeg.readUInt16BE(off + 2)
    if (marker === 0xe1 && jpeg.toString('latin1', off + 4, off + 8) === 'Exif') {
      return parseTiff(jpeg.subarray(off + 10, off + 2 + len))
    }
    off += 2 + len
  }
  return {}
}

function parseTiff(tiff: Buffer): RafInfo {
  const le = tiff.toString('latin1', 0, 2) === 'II'
  const u16 = (o: number) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o))
  const u32 = (o: number) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o))

  const entries = (ifd: number) => {
    const out = new Map<number, { type: number; count: number; valueOff: number }>()
    const n = u16(ifd)
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12
      out.set(u16(e), { type: u16(e + 2), count: u32(e + 4), valueOff: e + 8 })
    }
    return out
  }

  const info: RafInfo = {}
  const ifd0 = entries(u32(4))
  const model = ifd0.get(TAG_MODEL)
  if (model) {
    const at = model.count > 4 ? u32(model.valueOff) : model.valueOff
    info.model = tiff.toString('latin1', at, at + model.count).replace(/\0.*$/, '').trim()
  }
  const exifPtr = ifd0.get(TAG_EXIF_IFD)
  if (exifPtr) {
    const iso = entries(u32(exifPtr.valueOff)).get(TAG_ISO)
    if (iso) info.iso = iso.type === 3 ? u16(iso.valueOff) : u32(iso.valueOff)
  }
  return info
}

/**
 * Highest dynamic range setting the X100V allows at this ISO
 * (1 = DR100, 2 = DR200 from ISO 320, 3 = DR400 from ISO 640).
 * Above that the camera still renders over USB, but with a heavy colour cast.
 */
export function maxDynamicRange(iso: number | undefined): number {
  if (iso === undefined) return 3
  if (iso >= 640) return 3
  if (iso >= 320) return 2
  return 1
}

/** The full-size preview JPEG the camera embeds in every RAF (offset and length at bytes 84–91). */
export async function readRafPreview(path: string): Promise<Buffer | null> {
  const file = await open(path, 'r')
  try {
    const header = Buffer.alloc(92)
    await file.read(header, 0, header.length, 0)
    if (header.toString('latin1', 0, 16) !== 'FUJIFILMCCD-RAW ') return null
    const offset = header.readUInt32BE(84)
    const length = header.readUInt32BE(88)
    const jpeg = Buffer.alloc(length)
    await file.read(jpeg, 0, length, offset)
    return jpeg
  } finally {
    await file.close()
  }
}
