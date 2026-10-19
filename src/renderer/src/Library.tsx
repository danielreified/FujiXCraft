import { useCallback, useState } from 'react'
import type { RecipeFolder } from '../../shared/api.ts'
import { describeRecipe, type Recipe } from '../../shared/recipe.ts'
import { ContextMenu, type MenuItem, type MenuState } from './ContextMenu.tsx'

const OPEN_KEY = 'library-open-sections'
const DRAG_TYPE = 'application/x-recipe-id'

function loadOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

export interface LibrarySection {
  key: string
  title: string
  recipes: Recipe[]
  /** Open until the user collapses it. Other sections start collapsed. */
  open?: boolean
}

const newFolderId = () => `folder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

export function Library({ sections, folders, allRecipes, activeId, compareIds, compareFull, stars, onSelect, onToggleCompare, onToggleStar, onFoldersChange, onStageFolder, onClearCompare, onPaste, onNew }: {
  sections: LibrarySection[]
  /** User folders, shown after the first section (Starred). */
  folders: RecipeFolder[]
  /** Every recipe, for resolving folder contents. */
  allRecipes: Recipe[]
  activeId: string
  compareIds: Set<string>
  /** The compare selection is at its limit; unticked boxes dim. */
  compareFull: boolean
  stars: Set<string>
  onSelect: (id: string) => void
  onToggleCompare: (id: string) => void
  onToggleStar: (id: string) => void
  onFoldersChange: (folders: RecipeFolder[]) => void
  /** Stage a folder's recipes into C1–C7, in order. */
  onStageFolder: (recipes: Recipe[], folderName: string) => void
  onClearCompare: () => void
  onPaste: () => void
  onNew: () => void
}) {
  const [query, setQuery] = useState('')
  const [openState, setOpenState] = useState(loadOpen)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const q = query.trim().toLowerCase()
  const closeMenu = useCallback(() => setMenu(null), [])

  const setOpen = (key: string, open: boolean) => {
    const next = { ...openState, [key]: open }
    setOpenState(next)
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(next))
    } catch {
      // Remembering open sections is only a convenience.
    }
  }

  // ── Folder edits ───────────────────────────────────────

  const createFolder = (withRecipe?: string) => {
    const folder: RecipeFolder = { id: newFolderId(), name: 'New folder', recipeIds: withRecipe ? [withRecipe] : [] }
    onFoldersChange([...folders, folder])
    setOpen(`folder:${folder.id}`, true)
    setEditing(folder.id)
  }
  const renameFolder = (id: string, name: string) => {
    const clean = name.trim()
    onFoldersChange(folders.map(f => (f.id === id ? { ...f, name: clean || f.name } : f)))
    setEditing(null)
  }
  const deleteFolder = (id: string) => onFoldersChange(folders.filter(f => f.id !== id))
  const addTo = (folderId: string, recipeId: string) =>
    onFoldersChange(folders.map(f => (f.id === folderId && !f.recipeIds.includes(recipeId) ? { ...f, recipeIds: [...f.recipeIds, recipeId] } : f)))
  const removeFrom = (folderId: string, recipeId: string) =>
    onFoldersChange(folders.map(f => (f.id === folderId ? { ...f, recipeIds: f.recipeIds.filter(id => id !== recipeId) } : f)))

  // ── Right-click menus ──────────────────────────────────

  const open = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  const recipeMenu = (e: React.MouseEvent, r: Recipe, inFolder?: RecipeFolder) =>
    open(e, [
      {
        label: 'Add to folder',
        submenu: [
          ...folders.map(f => ({ label: f.name, checked: f.recipeIds.includes(r.id), onClick: () => (f.recipeIds.includes(r.id) ? removeFrom(f.id, r.id) : addTo(f.id, r.id)) })),
          ...(folders.length ? (['separator'] as MenuItem[]) : []),
          { label: 'New folder with this recipe…', onClick: () => createFolder(r.id) },
        ],
      },
      ...(inFolder ? [{ label: `Remove from “${inFolder.name}”`, onClick: () => removeFrom(inFolder.id, r.id) }] : []),
      'separator',
      ...(r.meta ? [{ label: stars.has(r.id) ? 'Unstar' : 'Star', onClick: () => onToggleStar(r.id) }] : []),
      { label: compareIds.has(r.id) ? 'Remove from Compare' : 'Add to Compare', disabled: compareFull && !compareIds.has(r.id), onClick: () => onToggleCompare(r.id) },
    ])

  const folderMenu = (e: React.MouseEvent, f: RecipeFolder) => {
    const recipes = f.recipeIds.map(id => byId.get(id)).filter((r): r is Recipe => !!r)
    const n = Math.min(recipes.length, 7)
    open(e, [
      {
        label: n ? `Stage into C1–C${n} (${n} recipe${n === 1 ? '' : 's'})` : 'Stage into C1–C7 (folder is empty)',
        disabled: !n,
        onClick: () => onStageFolder(recipes.slice(0, 7), f.name),
      },
      'separator',
      { label: 'Rename…', onClick: () => setEditing(f.id) },
      { label: 'New folder…', onClick: () => createFolder() },
      'separator',
      { label: `Delete “${f.name}”`, danger: true, onClick: () => deleteFolder(f.id) },
    ])
  }

  // ── Sections, with folders after the first ─────────────

  const byId = new Map(allRecipes.map(r => [r.id, r]))
  const folderSections = folders.map(f => ({
    key: `folder:${f.id}`,
    title: f.name,
    recipes: f.recipeIds.map(id => byId.get(id)).filter((r): r is Recipe => !!r),
    folder: f,
  }))
  const all: (LibrarySection & { folder?: RecipeFolder })[] = [sections[0], ...folderSections, ...sections.slice(1)].filter(Boolean)

  const row = (r: Recipe, folder?: RecipeFolder) => (
    <div
      key={r.id}
      className={`recipe-row${r.id === activeId ? ' active' : ''}`}
      onClick={() => onSelect(r.id)}
      onContextMenu={e => recipeMenu(e, r, folder)}
      draggable
      onDragStart={e => {
        e.dataTransfer.setData(DRAG_TYPE, r.id)
        e.dataTransfer.effectAllowed = 'copy'
      }}
    >
      <label className={`check${compareFull && !compareIds.has(r.id) ? ' full' : ''}`} title={compareFull && !compareIds.has(r.id) ? 'Compare is full (6). Untick one first.' : 'Include in Compare'} onClick={e => e.stopPropagation()}>
        <input type="checkbox" checked={compareIds.has(r.id)} onChange={() => onToggleCompare(r.id)} />
        <span />
      </label>
      <div className="recipe-text">
        <div className="recipe-name">{r.name}</div>
        <div className="recipe-desc">{describeRecipe(r.values)}</div>
      </div>
      {r.meta && (
        <button
          className={`row-star${stars.has(r.id) ? ' on' : ''}`}
          title={stars.has(r.id) ? 'Unstar' : 'Star'}
          onClick={e => {
            e.stopPropagation()
            onToggleStar(r.id)
          }}
        >
          {stars.has(r.id) ? '★' : '☆'}
        </button>
      )}
    </div>
  )

  return (
    <nav className="library">
      <div className="library-tools">
        <input className="search" placeholder="Search recipes" value={query} onChange={e => setQuery(e.target.value)} />
        <div className="library-actions">
          <button className="ghost" onClick={onPaste}>Paste recipe</button>
          <button className="ghost" onClick={onNew}>New</button>
          <button className="ghost" title="New folder" onClick={() => createFolder()}>＋ Folder</button>
        </div>
      </div>
      {compareIds.size > 0 && (
        <div className="compare-strip">
          <span>Compare <b>{compareIds.size}</b>/6 ticked</span>
          <button className="link" onClick={onClearCompare}>Clear all</button>
        </div>
      )}
      <div className="library-scroll" onContextMenu={e => open(e, [{ label: 'New folder…', onClick: () => createFolder() }])}>
        {all.map(section => {
          const folder = section.folder
          const recipes = q ? section.recipes.filter(r => r.name.toLowerCase().includes(q)) : section.recipes
          // Folders stay visible when empty so recipes can be dropped in; other empty sections hide.
          if (!recipes.length && !(folder && !q)) return null
          const isOpen = q ? true : (openState[section.key] ?? !!section.open)
          const isDrop = folder && dropTarget === folder.id
          return (
            <section
              key={section.key}
              className={`${isOpen ? 'open' : 'closed'}${folder ? ' folder' : ''}${isDrop ? ' drop' : ''}`}
              onDragOver={folder ? e => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
                setDropTarget(folder.id)
              } : undefined}
              onDragLeave={folder ? e => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null)
              } : undefined}
              onDrop={folder ? e => {
                e.preventDefault()
                e.stopPropagation()
                const id = e.dataTransfer.getData(DRAG_TYPE)
                if (id) addTo(folder.id, id)
                setDropTarget(null)
              } : undefined}
            >
              {folder && editing === folder.id ? (
                <div className="section-head editing">
                  <span className="chev">▾</span>
                  <input
                    autoFocus
                    defaultValue={folder.name}
                    onFocus={e => e.target.select()}
                    onBlur={e => renameFolder(folder.id, e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') renameFolder(folder.id, e.currentTarget.value)
                      if (e.key === 'Escape') setEditing(null)
                    }}
                  />
                </div>
              ) : (
                <button
                  className="section-head"
                  onClick={() => setOpen(section.key, !isOpen)}
                  onDoubleClick={folder ? () => setEditing(folder.id) : undefined}
                  onContextMenu={folder ? e => folderMenu(e, folder) : undefined}
                  disabled={!!q}
                >
                  <span className="chev">{isOpen ? '▾' : '▸'}</span>
                  {folder && <span className="folder-icon">▤</span>}
                  <span className="section-title">{section.title}</span>
                  <span className="section-count">{recipes.length}</span>
                </button>
              )}
              {isOpen && (
                <>
                  {recipes.map(r => row(r, folder))}
                  {folder && !recipes.length && <div className="folder-empty">Drag recipes here, or right-click a recipe → Add to folder</div>}
                </>
              )}
            </section>
          )
        })}
      </div>
      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
    </nav>
  )
}
