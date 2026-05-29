import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { TELEMETRY_CHANNELS, type LogAnalysis, type TelemetryChannel } from '../data/demoLog'
import { CardTitle } from './ui'

const CH: Record<string, TelemetryChannel> = Object.fromEntries(
  TELEMETRY_CHANNELS.map((c) => [c.key, c]),
)
const ALL_KEYS = TELEMETRY_CHANNELS.map((c) => c.key)

// Channels bucketed by subsystem, preserving declaration order.
const GROUPS = (() => {
  const order: string[] = []
  const map: Record<string, TelemetryChannel[]> = {}
  for (const ch of TELEMETRY_CHANNELS) {
    if (!map[ch.group]) {
      map[ch.group] = []
      order.push(ch.group)
    }
    map[ch.group].push(ch)
  }
  return order.map((g) => ({ group: g, channels: map[g] }))
})()

// A sensible starting view: altitude, ground speed, battery and vibration.
const DEFAULT_KEYS = ['alt', 'gspd', 'vbat', 'vibeZ']

const fmtTime = (s: number) => {
  const m = Math.floor(s / 60)
  const sec = Math.round(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

type TooltipProps = {
  active?: boolean
  label?: number
  payload?: { dataKey: string; payload: Record<string, number> }[]
}

// Always shows raw values even when the chart is plotting normalized series
// (the `_n` dataKey is stripped back to the real channel key for the lookup).
function TelemetryTooltip({ active, label, payload }: TooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-white/10 bg-zinc-950/90 px-3 py-2 shadow-xl backdrop-blur">
      <div className="mb-1 font-mono text-[11px] text-zinc-400">t = {fmtTime(label ?? 0)}</div>
      <div className="space-y-0.5">
        {payload.map((p) => {
          const key = String(p.dataKey).replace(/_n$/, '')
          const ch = CH[key]
          if (!ch) return null
          return (
            <div key={key} className="flex items-center gap-2 text-xs">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ch.color }} />
              <span className="text-zinc-400">{ch.label}</span>
              <span className="ml-auto font-mono text-zinc-100">
                {p.payload[key]}
                {ch.unit && <span className="text-zinc-500"> {ch.unit}</span>}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function TelemetryGraphs({ a }: { a: LogAnalysis }) {
  const [sel, setSel] = useState<string[]>(DEFAULT_KEYS)
  const [normalize, setNormalize] = useState(true)

  // Augment each row with min-max-normalized (0–100) variants of every channel
  // so disparate units can be overlaid and shape-compared on one axis.
  const data = useMemo<Record<string, number>[]>(() => {
    const tel = a.telemetry
    const range: Record<string, [number, number]> = {}
    for (const ch of TELEMETRY_CHANNELS) {
      let lo = Infinity
      let hi = -Infinity
      for (const row of tel) {
        const v = row[ch.key]
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      range[ch.key] = [lo, hi]
    }
    return tel.map((row) => {
      const out: Record<string, number> = { ...row }
      for (const ch of TELEMETRY_CHANNELS) {
        const [lo, hi] = range[ch.key]
        out[`${ch.key}_n`] = hi > lo ? ((row[ch.key] - lo) / (hi - lo)) * 100 : 50
      }
      return out
    })
  }, [a.telemetry])

  const toggle = (key: string) =>
    setSel((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  const setAll = (all: boolean) => setSel(all ? [...ALL_KEYS] : [])

  return (
    <div className="flex h-full flex-col">
      <CardTitle
        title="Telemetry"
        hint="hover to scrub · plot any channel"
        icon={
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M3 3v18h18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path
              d="m7 14 3-4 3 3 4-7"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        }
      />

      {/* Channel picker — every plottable channel, grouped by subsystem. */}
      <div className="mb-3 rounded-xl border border-white/[0.06] bg-zinc-900/40 p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[11px] font-medium text-zinc-400">
            Channels
            <span className="ml-1.5 text-zinc-600">{sel.length}/{ALL_KEYS.length}</span>
          </span>
          <span className="ml-auto flex items-center gap-1 text-[10px]">
            <button
              type="button"
              onClick={() => setAll(true)}
              className="rounded-full border border-white/10 px-2 py-0.5 text-zinc-400 hover:text-zinc-200"
            >
              all
            </button>
            <button
              type="button"
              onClick={() => setAll(false)}
              className="rounded-full border border-white/10 px-2 py-0.5 text-zinc-400 hover:text-zinc-200"
            >
              none
            </button>
          </span>
        </div>
        <div className="space-y-2">
          {GROUPS.map(({ group, channels }) => (
            <div key={group} className="flex flex-wrap items-center gap-1.5">
              <span className="w-20 shrink-0 text-[10px] uppercase tracking-[0.12em] text-zinc-600">
                {group}
              </span>
              {channels.map((ch) => {
                const on = sel.includes(ch.key)
                return (
                  <button
                    key={ch.key}
                    type="button"
                    onClick={() => toggle(ch.key)}
                    className={`rounded-full border px-2 py-0.5 text-[10px] leading-none transition ${
                      on
                        ? 'border-transparent text-zinc-950'
                        : 'border-white/10 text-zinc-400 hover:border-white/20 hover:text-zinc-200'
                    }`}
                    style={on ? { background: ch.color } : undefined}
                  >
                    {ch.label}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs text-zinc-500">
          Dashed lines mark flight-mode changes.{' '}
          {normalize ? 'Values are scaled 0–100%; hover for true values.' : 'Plotting raw values.'}
        </p>
        <button
          type="button"
          onClick={() => setNormalize((v) => !v)}
          className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] transition ${
            normalize
              ? 'border-sky-400/40 bg-sky-400/15 text-sky-300'
              : 'border-white/10 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Normalize 0–100%
        </button>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-zinc-900/40 p-3">
        {sel.length === 0 ? (
          <div className="flex h-[440px] items-center justify-center text-center text-xs text-zinc-500">
            Pick one or more channels above to plot them.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={440}>
            <LineChart data={data} margin={{ top: 6, right: 16, bottom: 0, left: -8 }}>
              <CartesianGrid stroke="#27272a" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                domain={[0, 'dataMax']}
                tickFormatter={fmtTime}
                stroke="#3f3f46"
                tick={{ fill: '#71717a', fontSize: 10 }}
                tickLine={false}
                minTickGap={28}
              />
              <YAxis
                stroke="#3f3f46"
                tick={{ fill: '#71717a', fontSize: 10 }}
                tickLine={false}
                width={40}
                domain={normalize ? [0, 100] : ['auto', 'auto']}
              />
              <Tooltip content={<TelemetryTooltip />} cursor={{ stroke: '#52525b', strokeWidth: 1 }} />
              {a.modes.map((m) => (
                <ReferenceLine
                  key={`${m.name}-${m.start}`}
                  x={m.start}
                  stroke="#3f3f46"
                  strokeDasharray="3 3"
                  strokeOpacity={0.7}
                />
              ))}
              {sel.map((k) => (
                <Line
                  key={k}
                  type="monotone"
                  dataKey={normalize ? `${k}_n` : k}
                  stroke={CH[k]?.color}
                  strokeWidth={1.6}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}

        {/* Active-channel legend with each channel's range. */}
        {sel.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {sel.map((k) => {
              const ch = CH[k]
              if (!ch) return null
              return (
                <span key={k} className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                  <span className="h-2 w-2 rounded-full" style={{ background: ch.color }} />
                  {ch.label}
                  {ch.unit && <span className="text-zinc-600">{ch.unit}</span>}
                </span>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
