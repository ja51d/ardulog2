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

// Default channel assignment per graph — chosen to surface the correlated
// vibration ↔ EKF event and the battery sag at a glance.
const DEFAULTS: string[][] = [
  ['alt', 'gspd'],
  ['vbat', 'curr'],
  ['vibeZ', 'ekfVel'],
]

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

function Graph({
  index,
  data,
  keys,
  normalize,
  modes,
  onToggle,
  onAll,
}: {
  index: number
  data: Record<string, number>[]
  keys: string[]
  normalize: boolean
  modes: LogAnalysis['modes']
  onToggle: (index: number, key: string) => void
  onAll: (index: number, all: boolean) => void
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-zinc-900/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-medium text-zinc-500">Graph {index + 1}</span>
        {TELEMETRY_CHANNELS.map((ch) => {
          const on = keys.includes(ch.key)
          return (
            <button
              key={ch.key}
              type="button"
              onClick={() => onToggle(index, ch.key)}
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
        <span className="ml-auto flex items-center gap-1 text-[10px]">
          <button
            type="button"
            onClick={() => onAll(index, true)}
            className="rounded-full border border-white/10 px-2 py-0.5 text-zinc-400 hover:text-zinc-200"
          >
            all
          </button>
          <button
            type="button"
            onClick={() => onAll(index, false)}
            className="rounded-full border border-white/10 px-2 py-0.5 text-zinc-400 hover:text-zinc-200"
          >
            none
          </button>
        </span>
      </div>

      <ResponsiveContainer width="100%" height={168}>
        <LineChart data={data} syncId="telemetry" margin={{ top: 6, right: 14, bottom: 0, left: -10 }}>
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
          {modes.map((m) => (
            <ReferenceLine
              key={`${m.name}-${m.start}`}
              x={m.start}
              stroke="#3f3f46"
              strokeDasharray="3 3"
              strokeOpacity={0.7}
            />
          ))}
          {keys.map((k) => (
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
    </div>
  )
}

export default function TelemetryGraphs({ a }: { a: LogAnalysis }) {
  const [sel, setSel] = useState<string[][]>(DEFAULTS)
  const [normalize, setNormalize] = useState(false)

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

  const toggle = (index: number, key: string) =>
    setSel((prev) =>
      prev.map((arr, i) =>
        i !== index ? arr : arr.includes(key) ? arr.filter((k) => k !== key) : [...arr, key],
      ),
    )
  const setAll = (index: number, all: boolean) =>
    setSel((prev) => prev.map((arr, i) => (i !== index ? arr : all ? [...ALL_KEYS] : [])))

  return (
    <div className="flex h-full flex-col">
      <CardTitle
        title="Telemetry"
        hint="hover to scrub · synced across graphs"
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

      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs text-zinc-500">
          Dashed lines mark flight-mode changes. Toggle any channel into any graph.
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

      <div className="grid gap-3">
        {sel.map((keys, i) => (
          <Graph
            key={i}
            index={i}
            data={data}
            keys={keys}
            normalize={normalize}
            modes={a.modes}
            onToggle={toggle}
            onAll={setAll}
          />
        ))}
      </div>
    </div>
  )
}
