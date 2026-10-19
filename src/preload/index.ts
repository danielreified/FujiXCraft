import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { BatchProgress, CameraStatus, RecipeLabApi } from '../shared/api.ts'

const api: RecipeLabApi = {
  status: () => ipcRenderer.invoke('camera:status'),
  connect: () => ipcRenderer.invoke('camera:connect'),
  disconnect: () => ipcRenderer.invoke('camera:disconnect'),
  pickRaws: () => ipcRenderer.invoke('raw:pick'),
  listRaws: () => ipcRenderer.invoke('raws:list'),
  addRaws: paths => ipcRenderer.invoke('raws:add', paths),
  removeRaw: path => ipcRenderer.invoke('raws:remove', path),
  loadRaw: path => ipcRenderer.invoke('raw:load', path),
  render: req => ipcRenderer.invoke('render', req),
  pickBatchFolder: () => ipcRenderer.invoke('batch:pickFolder'),
  exportAs: (values, format, name) => ipcRenderer.invoke('export:as', values, format, name),
  runBatch: req => ipcRenderer.invoke('batch:run', req),
  cancelBatch: () => ipcRenderer.invoke('batch:cancel'),
  onBatchProgress: fn => {
    const listener = (_e: IpcRendererEvent, p: BatchProgress) => fn(p)
    ipcRenderer.on('batch:progress', listener)
    return () => ipcRenderer.removeListener('batch:progress', listener)
  },
  openPath: path => ipcRenderer.invoke('file:open', path),
  listRecipes: () => ipcRenderer.invoke('recipes:list'),
  saveRecipes: recipes => ipcRenderer.invoke('recipes:save', recipes),
  fxwLibrary: () => ipcRenderer.invoke('fxw:library'),
  getStars: () => ipcRenderer.invoke('stars:get'),
  listFolders: () => ipcRenderer.invoke('folders:list'),
  saveFolders: folders => ipcRenderer.invoke('folders:save', folders),
  readSlots: () => ipcRenderer.invoke('slots:read'),
  writeSlot: (slot, name, values) => ipcRenderer.invoke('slots:write', slot, name, values),
  undoSlot: slot => ipcRenderer.invoke('slots:undo', slot),
  slotHistory: () => ipcRenderer.invoke('slots:history'),
  listBackups: () => ipcRenderer.invoke('backups:list'),
  createBackup: (label, auto) => ipcRenderer.invoke('backups:create', label, auto),
  restoreBackup: (id, slots) => ipcRenderer.invoke('backups:restore', id, slots),
  deleteBackup: id => ipcRenderer.invoke('backups:delete', id),
  exportBackup: id => ipcRenderer.invoke('backups:export', id),
  importBackup: () => ipcRenderer.invoke('backups:import'),
  exportLibrary: () => ipcRenderer.invoke('library:export'),
  importLibrary: () => ipcRenderer.invoke('library:import'),
  findXAcquireBackups: () => ipcRenderer.invoke('xacquire:find'),
  openXAcquire: () => ipcRenderer.invoke('xacquire:open'),
  saveStars: ids => ipcRenderer.invoke('stars:save', ids),
  exportJpeg: (fullPath, name) => ipcRenderer.invoke('file:export', fullPath, name),
  reveal: path => ipcRenderer.invoke('file:reveal', path),
  onStatus: fn => {
    const listener = (_e: IpcRendererEvent, s: CameraStatus) => fn(s)
    ipcRenderer.on('camera:status', listener)
    return () => ipcRenderer.removeListener('camera:status', listener)
  },
  pathForFile: file => webUtils.getPathForFile(file),
}

contextBridge.exposeInMainWorld('lab', api)
