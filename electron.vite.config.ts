import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    // Load node_modules at runtime instead of bundling them (fflate's ESM build clashes with the bundler's require shim).
    build: { externalizeDeps: true },
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  renderer: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react()],
  },
})
