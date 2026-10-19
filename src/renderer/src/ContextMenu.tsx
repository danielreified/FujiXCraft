import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type MenuItem =
  | { label: string; onClick: () => void; danger?: boolean; disabled?: boolean; checked?: boolean }
  | { label: string; submenu: MenuItem[] }
  | 'separator'

export interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

/** A right-click menu at a screen point. Closes on any outside click, Esc, scroll or blur. */
export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', key)
    window.addEventListener('wheel', close, { passive: true })
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', key)
      window.removeEventListener('wheel', close)
    }
  }, [onClose])
  return <Menu items={menu.items} x={menu.x} y={menu.y} onClose={onClose} />
}

function Menu({ items, x, y, onClose }: { items: MenuItem[]; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [sub, setSub] = useState<{ index: number; x: number; y: number } | null>(null)

  // Keep the menu on screen.
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setPos({
      x: Math.min(x, window.innerWidth - r.width - 8),
      y: Math.min(y, window.innerHeight - r.height - 8),
    })
  }, [x, y])

  return (
    <div ref={ref} className="ctx-menu" style={{ left: pos.x, top: pos.y }} onMouseDown={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()}>
      {items.map((item, i) => {
        if (item === 'separator') return <div key={i} className="ctx-sep" />
        if ('submenu' in item) {
          return (
            <div
              key={i}
              className={`ctx-item has-sub${sub?.index === i ? ' on' : ''}`}
              onMouseEnter={e => {
                const r = e.currentTarget.getBoundingClientRect()
                setSub({ index: i, x: r.right - 4, y: r.top - 5 })
              }}
            >
              <span>{item.label}</span>
              <span className="ctx-arrow">▸</span>
              {sub?.index === i && <Menu items={item.submenu} x={sub.x} y={sub.y} onClose={onClose} />}
            </div>
          )
        }
        return (
          <button
            key={i}
            className={`ctx-item${item.danger ? ' danger' : ''}`}
            disabled={item.disabled}
            onMouseEnter={() => setSub(null)}
            onClick={() => {
              onClose()
              item.onClick()
            }}
          >
            <span className="ctx-check">{item.checked ? '✓' : ''}</span>
            <span>{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}
