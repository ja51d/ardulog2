import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { LogAnalysis, PidAxisTrace } from '../data/demoLog'
import { CardTitle } from './ui'

const fmtTime = (s: number) => {
  const m = Math.floor(s / 60)
  const sec = Math.round(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

const COL = { target: '#38bdf8', actual: '#f472b6' }

function trackColor(pct: number) {
  if (pct >= 80) return { text: 'text-emerald-300', ring: 'ring-emerald-400/30 bg-emerald-400/10', dot: 'bg-emerald-400' }
  if (pct >= 60) return { text: 'text-amber-300', ring: 'ring-amber-400/30 bg-amber-400/10', dot: 'bg-amber-400' }
  return { text: 'text-rose-300', ring: 'ring-rose-500/30 bg-rose-500/10', dot: 'bg-rose-500' }
}

type TooltipProps = {
  active?: boolean
  label?: number
  payload?: { dataKey: string; value: number }[]
  unit: string
}

function PidTooltip({ active, label, payload, unit }: TooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-white/10 bg-zinc-950/90 px-3 py-2 shadow-xl backdrop-blur">
      <div className="mb-1 font-mono text-[11px] text-zinc-400">t = {fmtTime(label ?? 0)}</div>
      <div className="space-y-0.5">
        {payload.map((p) => (
          <div key={p.dataKey} className="flex items-center gap-2 text-xs">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: p.dataKey === 'target' ? COL.target : COL.actual }}
            />
            <span className="text-zinc-400">{p.dataKey === 'target' ? 'Demand' : 'Actual'}</span>
            <span className="ml-auto font-mono text-zinc-100">
              {p.value.toFixed(1)}
              <span className="text-zinc-500"> {unit}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function AxisChart({ axis, unit }: { axis: PidAxisTrace; unit: string }) {
  const data = axis.t.map((t, i) => ({ t, target: axis.target[i], actual: axis.actual[i] }))
  const c = trackColor(axis.trackPct)
  return (
    <div className="rounded-xl border border-white/[0.06] bg-zinc-900/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-sm font-medium text-zinc-100">{axis.axis}</span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${c.ring} ${c.text}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
          {axis.trackPct}% tracking
        </span>
        <span className="text-[11px] text-zinc-500">
          RMS err <span className="font-mono text-zinc-300">{axis.rmsError}</span> {unit} · max{' '}
          <span className="font-mono text-zinc-300">{axis.maxError}</span> {unit}
        </span>
        {axis.gains && (
          <span className="ml-auto flex items-center gap-1">
            {(['p', 'i', 'd'] as const).map((g) => (
              <code
                key={g}
                className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-sky-300/90"
              >
                {g.toUpperCase()} {axis.gains![g]}
              </code>
            ))}
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <LineChart data={data} margin={{ top: 6, right: 14, bottom: 0, left: -12 }}>
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
            width={42}
          />
          <Tooltip content={<PidTooltip unit={unit} />} cursor={{ stroke: '#52525b', strokeWidth: 1 }} />
          <Line type="monotone" dataKey="target" stroke={COL.target} strokeWidth={1.6} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="actual" stroke={COL.actual} strokeWidth={1.4} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/** PID rate-controller tuning view: demanded vs achieved per axis. */
export default function PidView({ a }: { a: LogAnalysis }) {
  const pid = a.pid
  return (
    <div className="flex h-full flex-col">
      <CardTitle
        title="PID rate tracking"
        hint={pid.source}
        icon={
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M3 16c3 0 3-8 6-8s3 8 6 8 3-6 6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        }
      />
      {pid.axes.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/10 py-16 text-center text-xs text-zinc-500">
          No PID or attitude-tracking data was logged for this flight.
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-4">
            <p className="text-xs leading-relaxed text-zinc-500">{pid.note}</p>
            <span className="ml-auto flex shrink-0 items-center gap-3 text-[11px] text-zinc-400">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: COL.target }} /> demand
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: COL.actual }} /> actual
              </span>
            </span>
          </div>
          <div className="grid gap-3">
            {pid.axes.map((ax) => (
              <AxisChart key={ax.axis} axis={ax} unit={pid.unit} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
