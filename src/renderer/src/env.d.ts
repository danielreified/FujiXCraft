/// <reference types="vite/client" />
import type { RecipeLabApi } from '../../shared/api.ts'

declare global {
  interface Window {
    lab: RecipeLabApi
  }
}
