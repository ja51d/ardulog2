import type { ReactNode } from 'react'
import type { Severity } from '../data/demoLog'

export const SEVERITY_STYLE: Record<
  Severity,
  { dot: string; text: string; ring: string; label: string }
> = {
  critical: {
    dot: 'bg-rose-500',
    text: 'text-rose-300',
    ring: 'ring-rose-500/30 bg-rose-500/10',
    label: 'Critical',
  },
  warning: {
    dot: 'bg-amber-400',
    text: 'text-amber-300',
    ring: 'ring-amber-400/30 bg-amber-400/10',
    label: 'Warning',
  },
  info: {
    dot: 'bg-sky-400',
    text: 'text-sky-300',
    ring: 'ring-sky-400/30 bg-sky-400/10',
    label: 'Info',
  },
  good: {
    dot: 'bg-emerald-400',
    text: 'text-emerald-300',
    ring: 'ring-emerald-400/30 bg-emerald-400/10',
    label: 'Healthy',
  },
}

export function CardTitle({
  icon,
  title,
  hint,
}: {
  icon?: ReactNode
  title: string
  hint?: string
}) {
  return (
    <div className="mb-4 flex items-center gap-2">
      {icon && <span className="text-sky-400">{icon}</span>}
      <h3 className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">
        {title}
      </h3>
      {hint && <span className="ml-auto text-[11px] text-zinc-500">{hint}</span>}
    </div>
  )
}

export function Stat({
  value,
  unit,
  label,
}: {
  value: string | number
  unit?: string
  label: string
}) {
  return (
    <div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-semibold tracking-tight text-zinc-50 tabular-nums">
          {value}
        </span>
        {unit && <span className="text-sm text-zinc-400">{unit}</span>}
      </div>
      <div className="mt-0.5 text-xs text-zinc-500">{label}</div>
    </div>
  )
}

export function Badge({
  children,
  severity = 'info',
}: {
  children: ReactNode
  severity?: Severity
}) {
  const s = SEVERITY_STYLE[severity]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${s.ring} ${s.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {children}
    </span>
  )
}

/**
 * Minimal dependency-free sparkline. Renders a normalized polyline (and an
 * optional soft area fill) into a fixed viewBox; preserveAspectRatio="none"
 * lets it stretch to whatever box it's placed in.
 */
export function Sparkline({
  data,
  className = '',
  stroke = '#38bdf8',
  fill = true,
}: {
  data: number[]
  className?: string
  stroke?: string
  fill?: boolean
}) {
  const W = 100
  const H = 40
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const step = W / (data.length - 1)
  const points = data.map((v, i) => {
    const x = i * step
    const y = H - ((v - min) / span) * (H - 4) - 2
    return [x, y] as const
  })
  const line = points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const area = `0,${H} ${line} ${W},${H}`
  const gradId = `spark-${stroke.replace(/[^a-z0-9]/gi, '')}`

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <polygon points={area} fill={`url(#${gradId})`} />}
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
