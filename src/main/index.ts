import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { BrowserWindow, app, dialog, ipcMain, nativeImage, net, protocol, shell } from 'electron'
import { usb } from 'usb'
import { DR_LABELS, recipeHash, type Recipe, type RecipeValues } from '../shared/recipe.ts'
import { supportsTiff } from '../shared/api.ts'
import type { BatchProgress, BatchRequest, BatchSummary, ExportFormat, CameraStatus, LibraryExport, LibraryRaw, LoadedRaw, RecipeFolder, RenderRequest, RenderResult, SlotBackup, SlotHistory, XAcquireBackup } from '../shared/api.ts'
import { FujiCamera } from './camera/session.ts'
import { FUJI_VENDOR_ID } from './camera/transport.ts'
import { OutputFormat } from './camera/profile.ts'

const FORMAT: Record<ExportFormat, { code: number; ext: string }> = {
  jpeg: { code: OutputFormat.JPEG, ext: 'jpg' },
  tiff16: { code: OutputFormat.TIFF16, ext: 'tif' },
}
import { fxwPhoto, loadFxwLibrary } from './fxw.ts'
import { maxDynamicRange, readRafInfo, readRafPreview } from './raf.ts'

const here = dirname(fileURLToPath(import.meta.url))
const camera = new FujiCamera()
let window: BrowserWindow | null = null
let raw: (LoadedRaw & { cacheDir: string }) | null = null
let liveToken = 0

const userData = () => app.getPath('userData')
const recipesFile = () => join(userData(), 'recipes.json')
const starsFile = () => join(userData(), 'stars.json')
const slotHistoryFile = () => join(userData(), 'slot-history.json')
const rawsFile = () => join(userData(), 'raws.json')
const foldersFile = () => join(userData(), 'folders.json')
const backupsFile = () => join(userData(), 'slot-backups.json')
/** Renders only live for the session; nothing is kept unless exported. */
const renderRoot = () => join(app.getPath('temp'), 'recipe-lab-renders')
const sha = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16)

protocol.registerSchemesAsPrivileged([
  { scheme: 'render', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'fxw', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'rawthumb', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

function status(): CameraStatus {
  return {
    connected: camera.connected,
    model: camera.info?.model,
    firmware: camera.info?.firmware,
    raw: raw ? { path: raw.path, name: raw.name, iso: raw.iso, model: raw.model, uploadSeconds: raw.uploadSeconds } : null,
  }
}

function pushStatus() {
  window?.webContents.send('camera:status', status())
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Clamp dynamic range to what the RAW's ISO allows; see maxDynamicRange. */
function effectiveValues(values: Partial<RecipeValues>, iso = raw?.iso): { values: Partial<RecipeValues>; note?: string } {
  const allowed = maxDynamicRange(iso)
  if (values.dynamicRange === undefined || values.dynamicRange <= allowed) return { values }
  const out = { ...values }
  delete out.dynamicRange
  return {
    values: out,
    note: `${DR_LABELS[values.dynamicRange]} needs a higher ISO than this RAW's ISO ${iso}, so it was rendered at ${DR_LABELS[allowed]}.`,
  }
}

async function render(req: RenderRequest): Promise<RenderResult> {
  if (!raw) throw new Error('Load a RAW first')
  const token = req.live ? ++liveToken : 0
  const { values, note } = effectiveValues(req.values)
  const key = sha(recipeHash(values))
  const fullPath = join(raw.cacheDir, `${key}.jpg`)
  const viewPath = join(raw.cacheDir, `${key}.view.jpg`)
  const result = (timings: RenderResult['timings'], cached: boolean): RenderResult => ({
    key, fullPath, viewUrl: `render://view/${encodeURIComponent(viewPath)}`, timings, cached, note,
  })

  if (existsSync(viewPath) && existsSync(fullPath)) return result(null, true)

  // While a slider is dragged only the newest live request is worth rendering.
  const out = await camera.render(values, true, () => req.live === true && token !== liveToken)
  if (!out) return { ...result(null, false), skipped: true }
  await writeFile(fullPath, out.jpeg)
  const view = nativeImage.createFromBuffer(Buffer.from(out.jpeg)).resize({ width: 2400, quality: 'good' })
  await writeFile(viewPath, view.toJPEG(88))
  return result(out.timings, false)
}

async function loadRecipes(): Promise<Recipe[]> {
  try {
    return JSON.parse(await readFile(recipesFile(), 'utf8')) as Recipe[]
  } catch {
    return []
  }
}

async function saveRecipes(recipes: Recipe[]) {
  await mkdir(userData(), { recursive: true })
  await writeFile(recipesFile(), JSON.stringify(recipes, null, 2))
}

// ── RAW library: the files the user added, by path (nothing is copied) ──

async function readRawLibrary(): Promise<LibraryRaw[]> {
  let list: LibraryRaw[] = []
  try {
    list = JSON.parse(await readFile(rawsFile(), 'utf8')) as LibraryRaw[]
  } catch {
    return []
  }
  return list.map(r => ({ ...r, missing: !existsSync(r.path) }))
}

async function saveRawLibrary(list: LibraryRaw[]) {
  await mkdir(userData(), { recursive: true })
  await writeFile(rawsFile(), JSON.stringify(list.map(({ missing: _missing, ...r }) => r), null, 2))
}

async function addRaws(paths: string[]): Promise<LibraryRaw[]> {
  const list = await readRawLibrary()
  const known = new Set(list.map(r => r.path))
  for (const path of paths) {
    if (known.has(path) || !/\.raf$/i.test(path)) continue
    const info = await readRafInfo(path)
    if (!info.model) continue
    list.push({ path, name: basename(path), iso: info.iso, model: info.model, addedAt: new Date().toISOString() })
    known.add(path)
  }
  await saveRawLibrary(list)
  return readRawLibrary()
}

/** A small preview of a RAF, from its embedded JPEG, cached for the session. */
async function rawThumb(path: string): Promise<Response> {
  const list = await readRawLibrary()
  if (!list.some(r => r.path === path)) return new Response('Not found', { status: 404 })
  const thumbPath = join(renderRoot(), 'thumbs', `${sha(path)}.jpg`)
  if (!existsSync(thumbPath)) {
    const preview = await readRafPreview(path)
    if (!preview) return new Response('Not found', { status: 404 })
    await mkdir(dirname(thumbPath), { recursive: true })
    await writeFile(thumbPath, nativeImage.createFromBuffer(preview).resize({ width: 480, quality: 'good' }).toJPEG(82))
  }
  return new Response(new Uint8Array(await readFile(thumbPath)), { headers: { 'content-type': 'image/jpeg' } })
}

// ── Batch export: one recipe over many RAWs ──

let batchCancelled = false

const safeName = (s: string) => s.replace(/[/\\:*?"<>|]+/g, '-').trim()

async function runBatch(req: BatchRequest): Promise<BatchSummary> {
  if (req.format === 'tiff16' && !supportsTiff(camera.info?.model)) throw new Error(`TIFF isn't supported over USB on the ${camera.info?.model}`)
  batchCancelled = false
  const previous = raw?.path
  const summary: BatchSummary = { done: 0, failed: [], cancelled: false, outDir: req.outDir, notes: 0 }
  const send = (p: BatchProgress) => window?.webContents.send('batch:progress', p)
  await mkdir(req.outDir, { recursive: true })

  for (const [index, path] of req.paths.entries()) {
    if (batchCancelled) {
      summary.cancelled = true
      break
    }
    const name = basename(path).replace(/\.raf$/i, '')
    send({ index, total: req.paths.length, name, state: 'rendering' })
    try {
      const info = await readRafInfo(path)
      if (camera.info?.model && info.model && info.model !== camera.info.model) throw new Error(`shot on an ${info.model}`)
      await camera.loadRaf(path)
      const { values, note } = effectiveValues(req.values, info.iso)
      if (note) summary.notes++
      const fmt = FORMAT[req.format ?? 'jpeg']
      const out = await camera.render(values, true, undefined, fmt.code)
      if (!out) throw new Error('render was skipped')
      await writeFile(join(req.outDir, `${safeName(name)} - ${safeName(req.recipeName)}.${fmt.ext}`), out.jpeg)
      summary.done++
      send({ index, total: req.paths.length, name, state: 'done' })
    } catch (err) {
      summary.failed.push({ name, error: errorMessage(err) })
      send({ index, total: req.paths.length, name, state: 'failed', error: errorMessage(err) })
    }
  }

  // Put the RAW the user was working on back on the camera.
  raw = null
  if (previous) {
    try {
      const info = await readRafInfo(previous)
      const uploadSeconds = await camera.loadRaf(previous)
      const st = await stat(previous)
      const cacheDir = join(renderRoot(), sha(`${previous}:${st.size}:${st.mtimeMs}`))
      await mkdir(cacheDir, { recursive: true })
      raw = { path: previous, name: basename(previous), iso: info.iso, model: info.model, uploadSeconds, cacheDir }
    } catch {
      // Leave no RAW loaded; the user can pick one again.
    }
  }
  pushStatus()
  return summary
}

// ── Backups ──

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

async function writeJson(path: string, data: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(data, null, 2))
}

const readBackups = () => readJson<SlotBackup[]>(backupsFile(), [])

async function createBackup(label: string, auto = false): Promise<SlotBackup> {
  const backup: SlotBackup = {
    id: `backup-${Date.now().toString(36)}`,
    label,
    createdAt: new Date().toISOString(),
    camera: camera.info?.model,
    auto,
    slots: await camera.readSlots(),
  }
  const all = [backup, ...(await readBackups())]
  // Keep every manual backup; keep only the 20 newest automatic ones.
  let autos = 0
  await writeJson(backupsFile(), all.filter(b => !b.auto || ++autos <= 20))
  return backup
}

/** The slot names stored in an X Acquire .dat (ASCII runs of capitals). */
function xAcquireSlotNames(data: Buffer): string[] {
  const text = data.toString('latin1')
  const names = [...text.matchAll(/[A-Z0-9][A-Z0-9 &\-'.]{3,24}(?=\0)/g)].map(m => m[0].trim())
  return [...new Set(names)].filter(n => !/^(FUJIFILM|X100|V{4,}|\d+$)/.test(n) && !/DSF|DSCF/.test(n)).slice(0, 7)
}

async function findXAcquireBackups(): Promise<XAcquireBackup[]> {
  const dirs = [app.getPath('documents'), app.getPath('desktop'), app.getPath('downloads')]
  const out: XAcquireBackup[] = []
  for (const dir of dirs) {
    let names: string[] = []
    try {
      names = await readdir(dir)
    } catch {
      continue
    }
    for (const name of names.filter(n => /^FUJIFILM_.*\.dat$/i.test(n))) {
      const path = join(dir, name)
      const data = await readFile(path)
      if (!data.subarray(0, 16).toString('latin1').startsWith('FUJIFILMX-BACKUP')) continue
      out.push({
        path,
        name,
        modified: (await stat(path)).mtime.toISOString(),
        camera: data.subarray(20, 32).toString('latin1').replace(/\0.*$/, '').trim(),
        slotNames: xAcquireSlotNames(data),
      })
    }
  }
  return out.sort((a, b) => b.modified.localeCompare(a.modified))
}

async function readSlotHistory(): Promise<SlotHistory> {
  try {
    return JSON.parse(await readFile(slotHistoryFile(), 'utf8')) as SlotHistory
  } catch {
    return {}
  }
}

async function saveSlotHistory(history: SlotHistory) {
  await mkdir(userData(), { recursive: true })
  await writeFile(slotHistoryFile(), JSON.stringify(history, null, 2))
}

function registerIpc() {
  ipcMain.handle('camera:status', () => status())

  ipcMain.handle('camera:connect', async () => {
    try {
      await camera.connect()
      raw = null
      return status()
    } catch (err) {
      throw new Error(errorMessage(err))
    } finally {
      pushStatus()
    }
  })

  ipcMain.handle('camera:disconnect', async () => {
    await camera.disconnect()
    raw = null
    pushStatus()
    return status()
  })

  ipcMain.handle('raw:pick', async () => {
    const res = await dialog.showOpenDialog(window!, {
      title: 'Add RAW files or a folder',
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [{ name: 'Fujifilm RAW', extensions: ['RAF', 'raf'] }],
    })
    if (res.canceled) return []
    // Folders add every RAF directly inside them.
    const paths: string[] = []
    for (const p of res.filePaths) {
      if ((await stat(p)).isDirectory()) {
        for (const name of (await readdir(p)).sort()) if (/\.raf$/i.test(name)) paths.push(join(p, name))
      } else paths.push(p)
    }
    return paths
  })
  ipcMain.handle('raws:list', () => readRawLibrary())
  ipcMain.handle('raws:add', (_e, paths: string[]) => addRaws(paths))
  ipcMain.handle('raws:remove', async (_e, path: string) => {
    await saveRawLibrary((await readRawLibrary()).filter(r => r.path !== path))
    return readRawLibrary()
  })

  ipcMain.handle('raw:load', async (_e, path: string) => {
    const info = await readRafInfo(path)
    if (camera.info?.model && info.model && info.model !== camera.info.model) {
      throw new Error(`This RAW is from an ${info.model}. Your ${camera.info.model} can only convert ${camera.info.model} RAWs.`)
    }
    const uploadSeconds = await camera.loadRaf(path)
    const st = await stat(path)
    const cacheDir = join(renderRoot(), sha(`${path}:${st.size}:${st.mtimeMs}`))
    await mkdir(cacheDir, { recursive: true })
    raw = { path, name: basename(path), iso: info.iso, model: info.model, uploadSeconds, cacheDir }
    pushStatus()
    return status()
  })

  ipcMain.handle('render', (_e, req: RenderRequest) => render(req))

  ipcMain.handle('batch:pickFolder', async () => {
    const res = await dialog.showOpenDialog(window!, {
      title: 'Choose where to save the JPEGs',
      defaultPath: app.getPath('pictures'),
      properties: ['openDirectory', 'createDirectory'],
    })
    return res.canceled ? null : res.filePaths[0]
  })
  ipcMain.handle('batch:run', (_e, req: BatchRequest) => runBatch(req))
  ipcMain.handle('export:as', async (_e, values: Partial<RecipeValues>, format: ExportFormat, suggestedName: string) => {
    if (!raw) throw new Error('Load a RAW first')
    if (format === 'tiff16' && !supportsTiff(camera.info?.model)) throw new Error(`TIFF isn't supported over USB on the ${camera.info?.model}`)
    const fmt = FORMAT[format]
    const res = await dialog.showSaveDialog(window!, {
      title: format === 'tiff16' ? 'Export 16-bit TIFF' : 'Export full-size JPEG',
      defaultPath: join(app.getPath('pictures'), `${safeName(suggestedName)}.${fmt.ext}`),
      filters: [{ name: format === 'tiff16' ? 'TIFF' : 'JPEG', extensions: [fmt.ext] }],
    })
    if (res.canceled || !res.filePath) return null
    const out = await camera.render(effectiveValues(values).values, true, undefined, fmt.code)
    if (!out) throw new Error('Render was skipped')
    await writeFile(res.filePath, out.jpeg)
    return res.filePath
  })
  ipcMain.handle('batch:cancel', () => {
    batchCancelled = true
  })
  ipcMain.handle('file:open', (_e, path: string) => shell.openPath(path))

  ipcMain.handle('recipes:list', () => loadRecipes())
  ipcMain.handle('recipes:save', async (_e, recipes: Recipe[]) => saveRecipes(recipes))

  ipcMain.handle('fxw:library', () => loadFxwLibrary())

  ipcMain.handle('folders:list', async () => {
    try {
      return JSON.parse(await readFile(foldersFile(), 'utf8'))
    } catch {
      return []
    }
  })
  ipcMain.handle('folders:save', async (_e, folders: unknown) => {
    await mkdir(userData(), { recursive: true })
    await writeFile(foldersFile(), JSON.stringify(folders, null, 2))
  })

  ipcMain.handle('backups:list', () => readBackups())
  ipcMain.handle('backups:create', (_e, label: string, auto?: boolean) => createBackup(label, auto))
  ipcMain.handle('backups:restore', async (_e, id: string, slots?: number[]) => {
    const backup = (await readBackups()).find(b => b.id === id)
    if (!backup) throw new Error('Backup not found')
    if (backup.camera && camera.info?.model && backup.camera !== camera.info.model) {
      throw new Error(`This backup is from an ${backup.camera}; the connected camera is an ${camera.info.model}.`)
    }
    await createBackup(`Before restoring “${backup.label}”`, true)
    const restored = []
    for (const slot of backup.slots.filter(s => !slots || slots.includes(s.slot))) restored.push(await camera.restoreSlot(slot))
    return restored
  })
  ipcMain.handle('backups:delete', async (_e, id: string) => {
    const next = (await readBackups()).filter(b => b.id !== id)
    await writeJson(backupsFile(), next)
    return next
  })
  ipcMain.handle('backups:export', async (_e, id: string) => {
    const backup = (await readBackups()).find(b => b.id === id)
    if (!backup) throw new Error('Backup not found')
    const res = await dialog.showSaveDialog(window!, {
      title: 'Export slot backup',
      defaultPath: join(app.getPath('documents'), `${safeName(backup.label)}.recipelab-slots.json`),
      filters: [{ name: 'Recipe Lab slot backup', extensions: ['json'] }],
    })
    if (res.canceled || !res.filePath) return null
    await writeJson(res.filePath, backup)
    return res.filePath
  })
  ipcMain.handle('backups:import', async () => {
    const res = await dialog.showOpenDialog(window!, { title: 'Import slot backup', properties: ['openFile'], filters: [{ name: 'Recipe Lab slot backup', extensions: ['json'] }] })
    const all = await readBackups()
    if (res.canceled) return all
    const b = await readJson<SlotBackup | null>(res.filePaths[0], null)
    if (!b || !Array.isArray(b.slots) || !b.slots.every(s => s.raw && typeof s.slot === 'number')) throw new Error("That file isn't a Recipe Lab slot backup")
    const imported = { ...b, id: `backup-${Date.now().toString(36)}`, auto: false, label: `${b.label} (imported)` }
    await writeJson(backupsFile(), [imported, ...all])
    return [imported, ...all]
  })

  ipcMain.handle('library:export', async () => {
    const data: LibraryExport = {
      app: 'recipe-lab',
      version: 1,
      exportedAt: new Date().toISOString(),
      recipes: await loadRecipes(),
      folders: await readJson<RecipeFolder[]>(foldersFile(), []),
      stars: await readJson<string[]>(starsFile(), []),
    }
    const res = await dialog.showSaveDialog(window!, {
      title: 'Export your recipes, folders and stars',
      defaultPath: join(app.getPath('documents'), `Recipe Lab library ${new Date().toISOString().slice(0, 10)}.recipelab.json`),
      filters: [{ name: 'Recipe Lab library', extensions: ['json'] }],
    })
    if (res.canceled || !res.filePath) return null
    await writeJson(res.filePath, data)
    return res.filePath
  })
  ipcMain.handle('library:import', async () => {
    const res = await dialog.showOpenDialog(window!, { title: 'Import a Recipe Lab library', properties: ['openFile'], filters: [{ name: 'Recipe Lab library', extensions: ['json'] }] })
    if (res.canceled) return null
    const data = await readJson<LibraryExport | null>(res.filePaths[0], null)
    if (!data || data.app !== 'recipe-lab') throw new Error("That file isn't a Recipe Lab library export")
    // Merge: add what's new, never overwrite what's here.
    const recipes = await loadRecipes()
    const names = new Set(recipes.map(r => r.name.toLowerCase()))
    const newRecipes = data.recipes.filter(r => !recipes.some(x => x.id === r.id) && !names.has(r.name.toLowerCase()))
    await saveRecipes([...recipes, ...newRecipes])
    const folders = await readJson<RecipeFolder[]>(foldersFile(), [])
    const newFolders = data.folders.filter(f => !folders.some(x => x.id === f.id))
    await writeJson(foldersFile(), [...folders, ...newFolders])
    const stars = await readJson<string[]>(starsFile(), [])
    const newStars = data.stars.filter(s => !stars.includes(s))
    await writeJson(starsFile(), [...stars, ...newStars])
    return { recipes: newRecipes.length, folders: newFolders.length, stars: newStars.length }
  })

  ipcMain.handle('xacquire:find', () => findXAcquireBackups())
  ipcMain.handle('xacquire:open', () => shell.openPath('/Applications/FUJIFILM X Acquire.app'))

  ipcMain.handle('slots:read', () => camera.readSlots())
  ipcMain.handle('slots:history', () => readSlotHistory())
  ipcMain.handle('slots:write', async (_e, slot: number, name: string, values: Partial<RecipeValues>) => {
    const { before, after, problems } = await camera.writeSlot(slot, name, values)
    // Keep what was there, newest first, so the write can be undone.
    const history = await readSlotHistory()
    history[slot] = [{ savedAt: new Date().toISOString(), data: before }, ...(history[slot] ?? [])].slice(0, 10)
    await saveSlotHistory(history)
    return { after, problems }
  })
  ipcMain.handle('slots:undo', async (_e, slot: number) => {
    const history = await readSlotHistory()
    const [last, ...rest] = history[slot] ?? []
    if (!last) throw new Error(`Nothing to undo for C${slot}`)
    const restored = await camera.restoreSlot(last.data)
    history[slot] = rest
    await saveSlotHistory(history)
    return restored
  })
  ipcMain.handle('stars:get', async () => {
    try {
      return JSON.parse(await readFile(starsFile(), 'utf8')) as string[]
    } catch {
      return null
    }
  })
  ipcMain.handle('stars:save', async (_e, ids: string[]) => {
    await mkdir(userData(), { recursive: true })
    await writeFile(starsFile(), JSON.stringify(ids))
  })

  ipcMain.handle('file:export', async (_e, fullPath: string, suggestedName: string) => {
    const res = await dialog.showSaveDialog(window!, {
      title: 'Export full-size JPEG',
      defaultPath: join(app.getPath('pictures'), suggestedName),
      filters: [{ name: 'JPEG', extensions: ['jpg'] }],
    })
    if (res.canceled || !res.filePath) return null
    await copyFile(fullPath, res.filePath)
    return res.filePath
  })

  ipcMain.handle('file:reveal', (_e, path: string) => shell.showItemInFolder(path))
}

function createWindow() {
  window = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1100,
    minHeight: 700,
    title: 'Recipe Lab',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#141210',
    webPreferences: {
      preload: join(here, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
    },
  })
  window.on('closed', () => (window = null))
  if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else window.loadFile(join(here, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  // Clear renders left behind by a crash, and the cache older versions kept in Application Support.
  await rm(renderRoot(), { recursive: true, force: true })
  await rm(join(userData(), 'renders'), { recursive: true, force: true })

  // Serve rendered previews from the cache, and nothing else.
  protocol.handle('render', req => {
    const path = decodeURIComponent(new URL(req.url).pathname.slice(1))
    if (!path.startsWith(renderRoot())) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(path).toString())
  })
  protocol.handle('rawthumb', req => rawThumb(decodeURIComponent(new URL(req.url).pathname.slice(1))))
  protocol.handle('fxw', req => fxwPhoto(decodeURIComponent(new URL(req.url).pathname.slice(1)), url => net.fetch(url)))

  usb.addEventListener('disconnect', (ev: Event) => {
    const device = (ev as unknown as { device?: { vendorId: number } }).device
    if (device?.vendorId !== FUJI_VENDOR_ID) return
    camera.lost().then(() => {
      raw = null
      pushStatus()
    })
  })

  registerIpc()
  createWindow()
  if (!app.isPackaged && process.env.RECIPE_LAB_DEV_HOOK) devHook(process.env.RECIPE_LAB_DEV_HOOK)
})

/**
 * Development only: on SIGUSR2, run `<dir>/step.js` in the window and save a
 * screenshot to `<dir>/shot.png`, so the UI can be exercised from a terminal.
 */
function devHook(dir: string) {
  process.on('SIGUSR2', async () => {
    if (!window) return
    let log = ''
    try {
      const step = await readFile(join(dir, 'step.js'), 'utf8').catch(() => '')
      if (step) log = String(await window.webContents.executeJavaScript(`(async () => { ${step} })()`))
      await new Promise(r => setTimeout(r, 400))
      const image = await window.webContents.capturePage()
      await writeFile(join(dir, 'shot.png'), image.toPNG())
    } catch (err) {
      log = `error: ${errorMessage(err)}`
    }
    await writeFile(join(dir, 'log.txt'), `${log}\n`)
  })
}

app.on('window-all-closed', async () => {
  await camera.disconnect().catch(() => undefined)
  app.quit()
})

app.on('will-quit', () => rmSync(renderRoot(), { recursive: true, force: true }))
