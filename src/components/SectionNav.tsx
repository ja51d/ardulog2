export interface NavItem {
  id: string
  label: string
}

/**
 * Floating, sticky page switcher. Each item is a tab; clicking one swaps the
 * active dashboard page (the parent renders only that page's content). Stays
 * pinned near the top so navigation is always within reach.
 */
export default function SectionNav({
  items,
  active,
  onSelect,
}: {
  items: readonly NavItem[]
  active: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="pointer-events-none sticky top-3 z-30 mb-10 flex justify-center">
      <nav className="pointer-events-auto flex max-w-[calc(100vw-2rem)] items-center gap-0.5 overflow-x-auto rounded-full border border-white/10 bg-zinc-950/70 p-1 shadow-xl shadow-black/40 backdrop-blur-md">
        {items.map((s) => {
          const isActive = s.id === active
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              aria-current={isActive ? 'page' : undefined}
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
