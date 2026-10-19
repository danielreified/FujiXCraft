import type { Recipe, RecipeValues } from './recipe.ts'

export interface FxwLibrary {
  recipes: Recipe[]
  /** When the Fuji X Weekly app last downloaded its library; null if the app's cache wasn't found. */
  updated: string | null
}

/** One custom setting slot (C1–C7) as read from the camera. */
export interface SlotData {
  slot: number
  name: string
  values: Partial<RecipeValues>
  /** Raw property bytes (hex) by property id, kept so a slot can be restored exactly. */
  raw: Record<string, string>
}

export interface SlotWriteResult {
  after: SlotData
  /** Settings the camera refused or that read back differently. Empty when the write fully verified. */
  problems: string[]
}

/** Previous contents of each slot, newest first, for undo. */
export type SlotHistory = Record<number, { savedAt: string; data: SlotData }[]>

/** A RAW in the user's library (referenced by path; nothing is copied). */
export interface LibraryRaw {
  path: string
  name: string
  iso?: number
  model?: string
  addedAt: string
  /** The file has moved or been deleted since it was added. */
  missing?: boolean
}

export const rawThumbUrl = (path: string) => `rawthumb://thumb/${encodeURIComponent(path)}`

/** A user folder: links to recipes by id. The recipes themselves stay where they are. */
export interface RecipeFolder {
  id: string
  name: string
  recipeIds: string[]
}

/** Export container: JPEG (as the camera's own) or 16-bit uncompressed TIFF for heavy editing. */
export type ExportFormat = 'jpeg' | 'tiff16'

/**
 * Bodies where TIFF over USB is confirmed (X-Processor 5, per FilmKit #15).
 * An X100V (X-Processor 4) asked for TIFF stops responding until power-cycled,
 * so it's only offered on these.
 */
const TIFF_MODELS = new Set(['X-T5', 'X-T50', 'X-H2', 'X-H2S', 'X-S20', 'X100VI', 'X-M5', 'X-E5', 'X-T30 III', 'GFX100 II', 'GFX100S II', 'GFX100RF'])
export const supportsTiff = (model?: string) => !!model && TIFF_MODELS.has(model.toUpperCase())

export interface BatchRequest {
  paths: string[]
  recipeName: string
  values: Partial<RecipeValues>
  outDir: string
  format: ExportFormat
}

export interface BatchProgress {
  index: number
  total: number
  name: string
  state: 'rendering' | 'done' | 'failed'
  error?: string
}

export interface BatchSummary {
  done: number
  failed: { name: string; error: string }[]
  cancelled: boolean
  outDir: string
  /** How many photos had their dynamic range limited by ISO. */
  notes: number
}

/** A snapshot of all of the camera's C1–C7 slots, restorable byte for byte. */
export interface SlotBackup {
  id: string
  label: string
  createdAt: string
  camera?: string
  /** Made automatically before a save or restore. */
  auto?: boolean
  slots: SlotData[]
}

/** Recipe Lab's own data, for moving between Macs. */
export interface LibraryExport {
  app: 'recipe-lab'
  version: 1
  exportedAt: string
  recipes: Recipe[]
  folders: RecipeFolder[]
  stars: string[]
}

export interface XAcquireBackup {
  path: string
  name: string
  modified: string
  camera: string
  /** Custom slot names found in the file. */
  slotNames: string[]
}

export interface LoadedRaw {
  path: string
  name: string
  iso?: number
  model?: string
  uploadSeconds: number
}

export interface CameraStatus {
  connected: boolean
  model?: string
  firmware?: string
  raw: LoadedRaw | null
}

export interface RenderRequest {
  values: Partial<RecipeValues>
  /** Live slider edits: superseded requests are dropped. */
  live?: boolean
}

export interface RenderResult {
  key: string
  viewUrl: string
  fullPath: string
  /** null when served from cache or skipped. */
  timings: { setup: number; camera: number; download: number; total: number } | null
  cached: boolean
  skipped?: boolean
  /** Set when the camera couldn't apply part of the recipe, e.g. DR400 at ISO 160. */
  note?: string
}

export interface RecipeLabApi {
  status(): Promise<CameraStatus>
  connect(): Promise<CameraStatus>
  disconnect(): Promise<CameraStatus>
  /** Choose RAW files and/or folders; returns RAF paths. */
  pickRaws(): Promise<string[]>
  listRaws(): Promise<LibraryRaw[]>
  addRaws(paths: string[]): Promise<LibraryRaw[]>
  removeRaw(path: string): Promise<LibraryRaw[]>
  loadRaw(path: string): Promise<CameraStatus>
  render(req: RenderRequest): Promise<RenderResult>
  pickBatchFolder(): Promise<string | null>
  /** Render the loaded RAW in the given format and save it where the user chooses. Returns the path, or null if cancelled. */
  exportAs(values: Partial<RecipeValues>, format: ExportFormat, suggestedName: string): Promise<string | null>
  runBatch(req: BatchRequest): Promise<BatchSummary>
  cancelBatch(): Promise<void>
  onBatchProgress(fn: (p: BatchProgress) => void): () => void
  openPath(path: string): Promise<string>
  listRecipes(): Promise<Recipe[]>
  saveRecipes(recipes: Recipe[]): Promise<void>
  fxwLibrary(): Promise<FxwLibrary>
  /** Starred recipe ids, or null before anything was ever starred. */
  getStars(): Promise<string[] | null>
  listFolders(): Promise<RecipeFolder[]>
  saveFolders(folders: RecipeFolder[]): Promise<void>
  readSlots(): Promise<SlotData[]>
  writeSlot(slot: number, name: string, values: Partial<RecipeValues>): Promise<SlotWriteResult>
  /** Put the slot back to what it was before the last write. */
  undoSlot(slot: number): Promise<SlotData>
  slotHistory(): Promise<SlotHistory>
  listBackups(): Promise<SlotBackup[]>
  createBackup(label: string, auto?: boolean): Promise<SlotBackup>
  /** Restore the given slots from a backup (all when omitted). A snapshot is taken first. */
  restoreBackup(id: string, slots?: number[]): Promise<SlotData[]>
  deleteBackup(id: string): Promise<SlotBackup[]>
  exportBackup(id: string): Promise<string | null>
  importBackup(): Promise<SlotBackup[]>
  exportLibrary(): Promise<string | null>
  /** Merge recipes, folders and stars from a file. Returns counts added. */
  importLibrary(): Promise<{ recipes: number; folders: number; stars: number } | null>
  findXAcquireBackups(): Promise<XAcquireBackup[]>
  openXAcquire(): Promise<string>
  saveStars(ids: string[]): Promise<void>
  exportJpeg(fullPath: string, suggestedName: string): Promise<string | null>
  reveal(path: string): Promise<void>
  onStatus(fn: (s: CameraStatus) => void): () => void
  /** Filesystem path of a file dropped onto the window. */
  pathForFile(file: File): string
}
