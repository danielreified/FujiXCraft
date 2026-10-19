/**
 * A PTP session with a Fujifilm camera in USB RAW CONV./BACKUP RESTORE mode.
 *
 * Render flow (same as X RAW Studio):
 *   upload RAF (0x900C + 0x900D) → read base profile (0xD185)
 *   → write patched profile (0xD185) → start conversion (0xD183)
 *   → poll for the result object → download it → delete it
 *
 * The RAF stays loaded, so later renders only send a new profile.
 */

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { RecipeValues } from '../../shared/recipe.ts'
import type { SlotData } from '../../shared/api.ts'
import { patchProfile } from './profile.ts'
import { SlotIO } from './slots.ts'
import { PTPOp, PTPResp, USBTransport, respName } from './transport.ts'

const PROP_START_CONVERSION = 0xd183
const PROP_RAW_PROFILE = 0xd185
const OBJECT_FORMAT_RAF = 0xf802

export interface RenderTimings {
  /** Writing the profile and starting the conversion. */
  setup: number
  /** The camera's processing time. */
  camera: number
  download: number
  total: number
}

export interface RenderOutput {
  jpeg: Uint8Array
  timings: RenderTimings
}

export interface DeviceInfo {
  manufacturer: string
  model: string
  firmware: string
}

/** macOS's camera daemons grab every PTP camera on plug-in; stop them so we can claim it. */
function releaseFromMacOS(): Promise<void> {
  return new Promise(resolve => {
    execFile('/usr/bin/killall', ['-9', 'ptpcamerad', 'mscamerad-xpc'], () => resolve())
  })
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function ptpString(view: DataView, off: number): [string, number] {
  const chars = view.getUint8(off)
  let s = ''
  for (let i = 0; i < chars; i++) {
    const c = view.getUint16(off + 1 + i * 2, true)
    if (c) s += String.fromCharCode(c)
  }
  return [s, off + 1 + chars * 2]
}

function encodePtpString(s: string): Uint8Array {
  const chars = s.length + 1
  const out = new Uint8Array(1 + chars * 2)
  const view = new DataView(out.buffer)
  view.setUint8(0, chars)
  for (let i = 0; i < s.length; i++) view.setUint16(1 + i * 2, s.charCodeAt(i), true)
  return out
}

function parseDeviceInfo(data: Uint8Array): DeviceInfo {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let off = 2 + 4 + 2 // StandardVersion, VendorExtensionID, VendorExtensionVersion
  ;[, off] = ptpString(view, off) // VendorExtensionDesc
  off += 2 // FunctionalMode
  for (let i = 0; i < 5; i++) off += 4 + view.getUint32(off, true) * 2 // five uint16 arrays
  const [manufacturer, a] = ptpString(view, off)
  const [model, b] = ptpString(view, a)
  const [firmware] = ptpString(view, b)
  return { manufacturer, model, firmware }
}

export class FujiCamera {
  private transport = new USBTransport()
  private baseProfile: Uint8Array | null = null
  private queue: Promise<unknown> = Promise.resolve()
  info: DeviceInfo | null = null
  loadedFile: string | null = null

  get connected(): boolean {
    return this.transport.device !== null
  }

  /** Run camera operations one at a time; PTP has a single transaction stream. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  connect(): Promise<DeviceInfo> {
    return this.exclusive(async () => {
      let lastError: unknown
      for (let attempt = 0; attempt < 4; attempt++) {
        await releaseFromMacOS()
        try {
          await this.transport.open()
          break
        } catch (err) {
          lastError = err
          await this.transport.close()
          await sleep(300)
        }
      }
      if (!this.transport.device) throw lastError instanceof Error ? lastError : new Error(String(lastError))

      let { code } = await this.transport.command(PTPOp.OpenSession, [1])
      if (code === PTPResp.SessionAlreadyOpen) {
        // A previous app left a session open; start a fresh one.
        await this.transport.command(PTPOp.CloseSession)
        ;({ code } = await this.transport.command(PTPOp.OpenSession, [1]))
      }
      if (code !== PTPResp.OK) throw new Error(`OpenSession failed: ${respName(code)}`)

      const info = await this.transport.command(PTPOp.GetDeviceInfo)
      this.info = parseDeviceInfo(info.data)
      this.baseProfile = null
      this.loadedFile = null
      return this.info
    })
  }

  disconnect(): Promise<void> {
    return this.exclusive(async () => {
      if (!this.connected) return
      try {
        await this.transport.command(PTPOp.CloseSession)
      } catch {
        // Ignore: the camera may have been unplugged.
      }
      await this.transport.close()
      this.baseProfile = null
      this.loadedFile = null
    })
  }

  /** Mark the camera as gone after a USB unplug. */
  async lost(): Promise<void> {
    await this.transport.close()
    this.baseProfile = null
    this.loadedFile = null
    this.info = null
  }

  /** Upload a RAF and keep it loaded for later renders. Returns the upload time in seconds. */
  loadRaf(path: string): Promise<number> {
    return this.exclusive(async () => {
      const start = performance.now()
      const raf = await readFile(path)
      await this.clearObjects()

      const info = concat(
        u32(0), u16(OBJECT_FORMAT_RAF), u16(0), u32(raf.length),
        u16(0), u32(0), u32(0), u32(0), u32(0), u32(0), u32(0), u32(0),
        u16(0), u32(0), u32(0),
        encodePtpString('FUP_FILE.dat'), new Uint8Array([0, 0, 0]),
      )
      let { code } = await this.transport.commandWithData(PTPOp.FujiSendObjectInfo, [0, 0, 0], info)
      if (code !== PTPResp.OK) throw new Error(`Camera refused the RAW (SendObjectInfo ${respName(code)})`)
      ;({ code } = await this.transport.commandWithData(PTPOp.FujiSendObject2, [], raf, 120_000))
      if (code !== PTPResp.OK) {
        throw new Error(code === 0x2002
          ? `The camera rejected ${basename(path)}. It only converts RAWs from the same camera model.`
          : `RAW upload failed: ${respName(code)}`)
      }

      const profile = await this.transport.command(PTPOp.GetDevicePropValue, [PROP_RAW_PROFILE])
      if (profile.code !== PTPResp.OK || profile.data.length === 0) {
        throw new Error(`Could not read the conversion profile: ${respName(profile.code)}`)
      }
      this.baseProfile = new Uint8Array(profile.data)
      this.loadedFile = path
      return (performance.now() - start) / 1000
    })
  }

  /**
   * Render the loaded RAF with a recipe. `full` returns the full-size JPEG, otherwise a 640×480 preview.
   * `isStale` is checked when the camera gets to this job; if it returns true the job is dropped (null).
   */
  render(values: Partial<RecipeValues>, full = true, isStale?: () => boolean, fileType?: number): Promise<RenderOutput | null> {
    return this.exclusive(async () => {
      if (isStale?.()) return null
      if (!this.baseProfile) throw new Error('No RAW loaded')
      const t0 = performance.now()

      let { code } = await this.transport.commandWithData(PTPOp.SetDevicePropValue, [PROP_RAW_PROFILE], patchProfile(this.baseProfile, values, fileType))
      if (code !== PTPResp.OK) throw new Error(`Camera rejected the recipe settings: ${respName(code)}`)
      ;({ code } = await this.transport.commandWithData(PTPOp.SetDevicePropValue, [PROP_START_CONVERSION], u16(full ? 1 : 0)))
      if (code !== PTPResp.OK) throw new Error(`Could not start the conversion: ${respName(code)}`)
      const t1 = performance.now()

      const handle = await this.waitForObject(30_000)
      const t2 = performance.now()

      let result = await this.transport.command(full ? PTPOp.GetObject : PTPOp.GetThumb, [handle], 180_000)
      if (!full && (result.code !== PTPResp.OK || result.data.length === 0)) {
        result = await this.transport.command(PTPOp.GetObject, [handle], 60_000)
      }
      if (result.code !== PTPResp.OK) throw new Error(`Download failed: ${respName(result.code)}`)
      const t3 = performance.now()
      await this.transport.command(PTPOp.DeleteObject, [handle]).catch(() => undefined)

      return {
        jpeg: result.data,
        timings: { setup: (t1 - t0) / 1000, camera: (t2 - t1) / 1000, download: (t3 - t2) / 1000, total: (t3 - t0) / 1000 },
      }
    })
  }

  readSlots(): Promise<SlotData[]> {
    return this.exclusive(() => new SlotIO(this.requireConnected()).readAll())
  }

  writeSlot(slot: number, name: string, values: Partial<RecipeValues>) {
    return this.exclusive(() => new SlotIO(this.requireConnected()).write(slot, name, values))
  }

  restoreSlot(previous: SlotData): Promise<SlotData> {
    return this.exclusive(() => new SlotIO(this.requireConnected()).restore(previous))
  }

  private requireConnected(): USBTransport {
    if (!this.connected) throw new Error('Connect the camera first')
    return this.transport
  }

  private async listObjects(): Promise<number[]> {
    const { code, data } = await this.transport.command(PTPOp.GetObjectHandles, [0xffffffff, 0, 0])
    if (code !== PTPResp.OK) throw new Error(`GetObjectHandles failed: ${respName(code)}`)
    if (data.length < 4) return []
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const count = view.getUint32(0, true)
    return Array.from({ length: count }, (_, i) => view.getUint32(4 + i * 4, true))
  }

  private async waitForObject(timeoutMs: number): Promise<number> {
    const start = performance.now()
    while (performance.now() - start < timeoutMs) {
      const handles = await this.listObjects()
      if (handles.length) return handles[0]
      await sleep(40)
    }
    throw new Error('The camera took too long to render')
  }

  /** Delete leftover results from an interrupted render. */
  private async clearObjects(): Promise<void> {
    for (const handle of await this.listObjects().catch(() => [])) {
      await this.transport.command(PTPOp.DeleteObject, [handle]).catch(() => undefined)
    }
  }
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2)
  new DataView(b.buffer).setUint16(0, n, true)
  return b
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, n >>> 0, true)
  return b
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}
