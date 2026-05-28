import type { CSSProperties, ReactNode } from 'react'

interface BentoCardProps {
  /** Grid span / sizing utilities (e.g. "lg:col-span-2 lg:row-span-2"). */
  className?: string
  children: ReactNode
}

// Only the 1px padding ring is kept visible by the mask, so the radial
// gradient reads as a border that glows where the cursor is.
const borderGlowStyle: CSSProperties = {
  background:
    'radial-gradient(420px circle at var(--mx, 50%) var(--my, 50%), rgba(56,189,248,0.45), transparent 40%)',
  padding: '1px',
  WebkitMask:
    'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
  WebkitMaskComposite: 'xor',
  mask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
  maskComposite: 'exclude',
}

const innerGlowStyle: CSSProperties = {
  background:
    'radial-gradient(600px circle at var(--mx, 50%) var(--my, 50%), rgba(168,85,247,0.12), transparent 60%)',
}

export default function BentoCard({ className = '', children }: BentoCardProps) {
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    // Update CSS custom properties only — no React state, no re-render.
    e.currentTarget.style.setProperty('--mx', `${e.clientX - rect.left}px`)
    e.currentTarget.style.setProperty('--my', `${e.clientY - rect.top}px`)
  }

  return (
    <div
      data-bento-card
      onMouseMove={handleMouseMove}
      className={`group relative overflow-hidden rounded-3xl border border-white/[0.07] bg-zinc-900/40 p-6 backdrop-blur-sm transition-colors duration-300 hover:border-white/15 ${className}`}
    >
      {/* Glowing border that follows the cursor. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-px rounded-3xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={borderGlowStyle}
      />
      {/* Soft inner spotlight that follows the cursor. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-3xl opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={innerGlowStyle}
      />
      <div className="relative z-10 flex h-full flex-col">{children}</div>
    </div>
  )
}
