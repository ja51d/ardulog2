import { useEffect, useState } from 'react'

export interface NavItem {
  id: string
  label: string
}

/**
 * Floating, sticky section switcher. Highlights the section currently in view
 * (scroll-spy via IntersectionObserver) and smooth-scrolls to a section on
 * click. Sits above the dashboard and stays pinned near the top as you scroll.
 */
export default function SectionNav({ items }: { items: readonly NavItem[] }) {
  const [active, setActive] = useState(items[0]?.id ?? '')

  useEffect(() => {
    const els = items
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null)
    if (els.length === 0) return

    // Track each section's visibility; the active one is the first (top-most in
    // document order) section currently crossing the upper band of the viewport.
    const visible = new Map<string, boolean>()
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting)
        const current = items.find((s) => visible.get(s.id))
        if (current) setActive(current.id)
      },
      { rootMargin: '-20% 0px -55% 0px', threshold: 0 },
    )
    els.forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [items])

  const go = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="pointer-events-none sticky top-3 z-30 mb-10 flex justify-center">
      <nav className="pointer-events-auto flex max-w-[calc(100vw-2rem)] items-center gap-0.5 overflow-x-auto rounded-full border border-white/10 bg-zinc-950/70 p-1 shadow-xl shadow-black/40 backdrop-blur-md">
        {items.map((s) => {
          const isActive = s.id === active
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => go(s.id)}
              aria-current={isActive ? 'true' : undefined}
              className={`relative shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors duration-200 sm:px-4 ${
                isActive ? 'text-zinc-950' : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              {isActive && (
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-full bg-gradient-to-r from-sky-400 to-cyan-300"
                />
              )}
              <span className="relative">{s.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
