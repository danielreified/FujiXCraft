/**
 * Read the recipe library the Fuji X Weekly app keeps on this Mac.
 *
 * The FXW app downloads its whole library as one spreadsheet
 * ("FXW App Recipes.xlsx") into its URL cache, and caches the sample photos
 * under the md5 of their URL. We only read those local copies; open the FXW
 * app to refresh them. Patron-only, video and infrared recipes are skipped.
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { parseRecipeText } from '../shared/parse-recipe.ts'
import type { FxwLibrary } from '../shared/api.ts'
import type { Recipe, RecipeMeta } from '../shared/recipe.ts'

const CONTAINER = join(homedir(), 'Library/Containers/com.fujixweekly.fujixweeklyrecipes/Data/Library/Caches/com.fujixweekly.fujixweeklyrecipes/fsCachedData')
const PHOTO_CACHE = join(homedir(), 'Library/Group Containers/group.com.fujixweekly.fujixweeklyrecipes/com.fujixweekly.imageCache/default')

let photoUrls = new Set<string>()

const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(parseInt(e[1] === 'x' ? e.slice(2) : e.slice(1), e[1] === 'x' ? 16 : 10))
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()]
  })

/** The first worksheet as rows of strings. */
function readSheet(xlsx: Uint8Array): string[][] {
  const files = unzipSync(xlsx, { filter: f => f.name === 'xl/sharedStrings.xml' || f.name === 'xl/worksheets/sheet1.xml' })
  const strings = [...strFromU8(files['xl/sharedStrings.xml'] ?? new Uint8Array()).matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m =>
    decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')),
  )
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml'])
  const rows: string[][] = []
  for (const row of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = []
    for (const c of row[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      let col = 0
      for (const ch of c[1]) col = col * 26 + ch.charCodeAt(0) - 64
      const attrs = c[2]
      const body = c[3] ?? ''
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]
      let value = ''
      if (/t="s"/.test(attrs) && v !== undefined) value = strings[Number(v)] ?? ''
      else if (/t="inlineStr"/.test(attrs)) value = decode([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''))
      else if (v !== undefined) value = decode(v)
      cells[col - 1] = value.trim()
    }
    rows.push(Array.from(cells, x => x ?? ''))
  }
  return rows
}

/** The newest cached copy of the library spreadsheet. */
async function findLibraryFile(): Promise<{ path: string; mtime: Date } | null> {
  if (!existsSync(CONTAINER)) return null
  let best: { path: string; mtime: Date } | null = null
  for (const name of await readdir(CONTAINER)) {
    const path = join(CONTAINER, name)
    const st = await stat(path)
    if (best && st.mtime <= best.mtime) continue
    const head = (await readFile(path)).subarray(0, 4096)
    if (head[0] === 0x50 && head[1] === 0x4b && head.includes(Buffer.from('[Content_Types].xml'))) best = { path, mtime: st.mtime }
  }
  return best
}

const split = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean)

function toRecipe(row: Record<string, string>): Recipe {
  const wbShift = `${row['WB Shift Red'] || 0} Red & ${row['WB Shift Blue'] || 0} Blue`
  const text = [
    `Film Simulation: ${row['Film Simulation']}`,
    `Dynamic Range: ${row['Dynamic Range']}`,
    `Highlight: ${row.Highlight}`,
    `Shadow: ${row.Shadow}`,
    `Color: ${row.Color}`,
    `Noise Reduction: ${row['Noise Reduction']}`,
    `Sharpening: ${row.Sharpening}`,
    `Clarity: ${row.Clarity}`,
    `Grain Effect: ${row['Grain Effect']}`,
    `Color Chrome Effect: ${row['Color Chrome Effect']}`,
    `Color Chrome Effect Blue: ${row['Color Chrome Effect Blue']}`,
    row['White Balance'] ? `White Balance: ${row['White Balance']}, ${wbShift}` : '',
  ].join('\n')
  const { values } = parseRecipeText(text)

  const unsupported: string[] = []
  if (/DR-?P/i.test(row['Dynamic Range'])) unsupported.push(`D-Range Priority (${row['Dynamic Range']})`)
  // Monochrome toning (warm/cool, magenta/green) isn't mapped to the camera profile yet.
  if (/[1-9]/.test(row.Toning)) unsupported.push(`Toning (${row.Toning})`)

  const meta: RecipeMeta = {
    fxwId: row['Recipe ID'],
    sensor: row.Sensor,
    cameras: split(row.Camera),
    date: row.Date,
    isColor: row['Color or B&W'] !== 'B&W',
    keywords: split(row['Keyword Descriptions']),
    photos: split(row.Photographs).filter(u => u.startsWith('https://')),
    iso: row.ISO || undefined,
    exposure: row['Exposure Compensation'] || undefined,
    filmSimulation: row['Film Simulation'],
    unsupported,
  }
  if (!meta.photos.length && row['Feature Picture']) meta.photos = [row['Feature Picture']]

  return {
    id: `fxw-${row['Recipe ID'] || row.Recipe}`,
    name: row.Recipe,
    source: row['Recipe Website'] || undefined,
    notes: meta.exposure ? `Exposure: ${meta.exposure} typically.` : undefined,
    builtIn: true,
    values,
    meta,
  }
}

export async function loadFxwLibrary(): Promise<FxwLibrary> {
  const file = await findLibraryFile()
  if (!file) return { recipes: [], updated: null }

  const rows = readSheet(new Uint8Array(await readFile(file.path)))
  const header = rows[0]
  const recipes = rows
    .slice(1)
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
    .filter(r => r.Recipe && !r.Subscription && !r['Video Recipe'] && !r['Infrared Recipe'])
    .map(toRecipe)
    .filter(r => r.values.filmSimulation !== undefined)

  photoUrls = new Set(recipes.flatMap(r => r.meta?.photos ?? []))
  return { recipes, updated: file.mtime.toISOString() }
}

/** A sample photo: from the FXW app's cache when it has it, otherwise fetched. */
export async function fxwPhoto(url: string, fetchRemote: (url: string) => Promise<Response>): Promise<Response> {
  if (!photoUrls.has(url)) return new Response('Not found', { status: 404 })
  const md5 = createHash('md5').update(url).digest('hex')
  for (const ext of ['jpg', 'png']) {
    const path = join(PHOTO_CACHE, `${md5}.${ext}`)
    if (existsSync(path)) {
      return new Response(new Uint8Array(await readFile(path)), {
        headers: { 'content-type': ext === 'png' ? 'image/png' : 'image/jpeg', 'cache-control': 'max-age=86400' },
      })
    }
  }
  return fetchRemote(url)
}
