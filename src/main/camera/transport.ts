/**
 * PTP over USB bulk transfers.
 *
 * Ported from FilmKit's WebUSB transport (MIT License, Copyright (c) 2026
 * eggricesoy, github.com/eggricesoy/filmkit). The `usb` package exposes the
 * same WebUSB API in Node, so the logic carries over almost unchanged.
 */

import { usb } from 'usb'

export const FUJI_VENDOR_ID = 0x04cb

export const ContainerType = { Command: 1, Data: 2, Response: 3 } as const

export const PTPOp = {
  GetDeviceInfo: 0x1001,
  OpenSession: 0x1002,
  CloseSession: 0x1003,
  GetObjectHandles: 0x1007,
  GetObject: 0x1009,
  GetThumb: 0x100a,
  DeleteObject: 0x100b,
  GetDevicePropValue: 0x1015,
  SetDevicePropValue: 0x1016,
  FujiSendObjectInfo: 0x900c,
  FujiSendObject2: 0x900d,
} as const

export const PTPResp = {
  OK: 0x2001,
  SessionAlreadyOpen: 0x201e,
} as const

const HEADER_SIZE = 12
const CHUNK_SIZE = 512 * 1024
const DEFAULT_TIMEOUT = 5_000

/** `usb` returns WebUSB-compatible devices; its own typings omit the transfer methods. */
type UsbDevice = USBDevice

interface Container {
  type: number
  code: number
  transactionId: number
  params: number[]
  data: Uint8Array
}

export interface CommandResult {
  code: number
  params: number[]
  data: Uint8Array
}

function pack(c: Container): Uint8Array {
  const params = c.params.slice(0, 5)
  const out = new Uint8Array(HEADER_SIZE + params.length * 4 + c.data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, out.length, true)
  view.setUint16(4, c.type, true)
  view.setUint16(6, c.code, true)
  view.setUint32(8, c.transactionId, true)
  params.forEach((p, i) => view.setUint32(HEADER_SIZE + i * 4, p >>> 0, true))
  out.set(c.data, HEADER_SIZE + params.length * 4)
  return out
}

function unpack(raw: Uint8Array): Container {
  if (raw.length < HEADER_SIZE) throw new Error(`PTP container too short: ${raw.length} bytes`)
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const type = view.getUint16(4, true)
  const rest = raw.subarray(HEADER_SIZE)
  const params: number[] = []
  if (type === ContainerType.Response) {
    for (let off = 0; off + 4 <= rest.length && params.length < 5; off += 4) {
      params.push(view.getUint32(HEADER_SIZE + off, true))
    }
  }
  return {
    type,
    code: view.getUint16(6, true),
    transactionId: view.getUint32(8, true),
    params,
    data: type === ContainerType.Data ? rest : new Uint8Array(0),
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export class USBTransport {
  device: UsbDevice | null = null
  private epOut = 0
  private epIn = 0
  private transactionId = 0

  /** Find the first connected Fujifilm camera and claim its PTP interface. */
  async open(): Promise<void> {
    const devices = (await usb.getDevices()) as unknown as USBDevice[]
    const device = devices.find(d => d.vendorId === FUJI_VENDOR_ID)
    if (!device) throw new Error('No Fujifilm camera found. Is it on, plugged in, and in USB RAW CONV./BACKUP RESTORE mode?')

    await device.open()
    if (!device.configuration) await device.selectConfiguration(1)
    await device.claimInterface(0)

    const endpoints = device.configuration!.interfaces[0].alternate.endpoints
    this.epOut = endpoints.find(e => e.type === 'bulk' && e.direction === 'out')?.endpointNumber ?? 0
    this.epIn = endpoints.find(e => e.type === 'bulk' && e.direction === 'in')?.endpointNumber ?? 0
    if (!this.epOut || !this.epIn) throw new Error('Camera has no bulk endpoints')

    this.device = device
    this.transactionId = 0
  }

  async close(): Promise<void> {
    const device = this.device
    this.device = null
    if (!device) return
    try {
      await device.releaseInterface(0)
      await device.close()
    } catch {
      // The camera may already be gone.
    }
  }

  get productName(): string {
    return this.device?.productName ?? 'Fujifilm camera'
  }

  private nextTransactionId(): number {
    this.transactionId = (this.transactionId + 1) >>> 0
    return this.transactionId
  }

  private async send(c: Container, timeout: number): Promise<void> {
    const device = this.requireDevice()
    const bytes = pack(c)
    for (let off = 0; off < bytes.length; off += CHUNK_SIZE) {
      const chunk = bytes.subarray(off, off + CHUNK_SIZE)
      const result = await withTimeout(device.transferOut(this.epOut, chunk as Uint8Array<ArrayBuffer>), timeout, 'USB write')
      if (result.status !== 'ok') throw new Error(`USB write failed: ${result.status}`)
    }
  }

  private async recv(timeout: number): Promise<Container> {
    const device = this.requireDevice()
    const read = async () => {
      const result = await withTimeout(device.transferIn(this.epIn, CHUNK_SIZE), timeout, 'USB read')
      if (result.status !== 'ok' || !result.data) throw new Error(`USB read failed: ${result.status}`)
      return new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength)
    }

    const first = await read()
    const total = new DataView(first.buffer, first.byteOffset, first.byteLength).getUint32(0, true)
    if (first.length >= total) return unpack(first)

    // Large DATA phase (e.g. a 15 MB JPEG): read straight into one buffer.
    const buf = new Uint8Array(total)
    buf.set(first)
    let got = first.length
    while (got < total) {
      const more = await read()
      if (more.length === 0) throw new Error(`Short PTP container: ${got} of ${total} bytes`)
      buf.set(more.subarray(0, total - got), got)
      got += more.length
    }
    return unpack(buf)
  }

  /** Send a command; the camera may answer with a DATA phase before the RESPONSE. */
  async command(opcode: number, params: number[] = [], timeout = DEFAULT_TIMEOUT): Promise<CommandResult> {
    const transactionId = this.nextTransactionId()
    await this.send({ type: ContainerType.Command, code: opcode, transactionId, params, data: new Uint8Array(0) }, timeout)

    let resp = await this.recv(timeout)
    let data: Uint8Array = new Uint8Array(0)
    if (resp.type === ContainerType.Data) {
      data = resp.data
      resp = await this.recv(timeout)
    }
    if (resp.type !== ContainerType.Response) throw new Error(`Expected PTP response, got type ${resp.type}`)
    return { code: resp.code, params: resp.params, data }
  }

  /** Send a command followed by a DATA phase carrying `data`. */
  async commandWithData(opcode: number, params: number[], data: Uint8Array, timeout = DEFAULT_TIMEOUT): Promise<CommandResult> {
    const transactionId = this.nextTransactionId()
    await this.send({ type: ContainerType.Command, code: opcode, transactionId, params, data: new Uint8Array(0) }, timeout)
    await this.send({ type: ContainerType.Data, code: opcode, transactionId, params: [], data }, timeout)
    const resp = await this.recv(timeout)
    if (resp.type !== ContainerType.Response) throw new Error(`Expected PTP response, got type ${resp.type}`)
    return { code: resp.code, params: resp.params, data: new Uint8Array(0) }
  }

  private requireDevice(): UsbDevice {
    if (!this.device) throw new Error('Camera not connected')
    return this.device
  }
}

export function respName(code: number): string {
  return `0x${code.toString(16).padStart(4, '0')}`
}
