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
