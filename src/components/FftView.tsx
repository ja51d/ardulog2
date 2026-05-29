import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { FftTrace, LogAnalysis } from '../data/demoLog'
import { CardTitle, Stat } from './ui'

const AXIS_COLOR: Record<string, string> = {
  GyrX: '#38bdf8',
  GyrY: '#22d3ee',
  GyrZ: '#a855f7',
}
const colorOf = (axis: string) => AXIS_COLOR[axis] ?? '#7dd3fc'

type TooltipProps = {
  active?: boolean
  label?: number
  payload?: { dataKey: string; value: number }[]
}

function FftTooltip({ active, label, payload }: TooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-white/10 bg-zinc-950/90 px-3 py-2 shadow-xl backdrop-blur">
      <div className="mb-1 font-mono text-[11px] text-zinc-400">{(label ?? 0).toFixed(0)} Hz</div>
      <div className="space-y-0.5">
        {payload.map((p) => (
          <div key={p.dataKey} className="flex items-center gap-2 text-xs">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorOf(p.dataKey) }} />
            <span className="text-zinc-400">{p.dataKey}</span>
            <span className="ml-auto font-mono text-zinc-100">{p.value.toFixed(3)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Gyro noise spectrum (FFT) for harmonic-notch tuning. */
export default function FftView({ a }: { a: LogAnalysis }) {
  const fft = a.fft
  const empty = fft.axes.length === 0

  const data = fft.freqs.map((f, i) => {
    const row: Record<string, number> = { f }
    for (const ax of fft.axes) row[ax.axis] = ax.mag[i]
    return row
  })
  const nyquist = Math.round(fft.sampleRateHz / 2)
  // The first axis carries the soft area fill; the rest are crisp overlay lines.
  const [first, ...rest] = fft.axes as [FftTrace, ...FftTrace[]]

  return (
    <div className="flex h-full flex-col">
      <CardTitle
        title="Gyro FFT"
        hint={fft.source}
        icon={
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M3 20V10m4 10V4m4 16v-7m4 7V8m4 12v-4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        }
      />
      {empty ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/10 py-16 text-center text-xs text-zinc-500">
          {fft.note}
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <Stat value={fft.dominantHz.toFixed(0)} unit="Hz" label="Dominant peak" />
            <Stat value={fft.sampleRateHz.toLocaleString()} unit="Hz" label="Sample rate" />
            <Stat value={nyquist.toLocaleString()} unit="Hz" label="Nyquist" />
            {fft.reliable ? (
              <div>
                <div className="flex items-baseline gap-1">
                  <span className="text-sm text-zinc-400">notch →</span>
                  <code className="rounded bg-sky-500/15 px-1.5 py-0.5 font-mono text-xs text-sky-300">
                    {fft.dominantHz.toFixed(0)}
                  </code>
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">INS_HNTCH_FREQ</div>
              </div>
            ) : (
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/10 px-2 py-0.5 text-[11px] font-medium text-amber-300 ring-1 ring-inset ring-amber-400/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  low log rate
                </span>
                <div className="mt-0.5 text-xs text-zinc-500">below motor band</div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-white/[0.06] bg-zinc-900/40 p-3">
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={data} margin={{ top: 6, right: 16, bottom: 4, left: -8 }}>
                <defs>
                  <linearGradient id="fft-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colorOf(first.axis)} stopOpacity="0.35" />
                    <stop offset="100%" stopColor={colorOf(first.axis)} stopOpacity="0" />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#27272a" strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="f"
                  type="number"
                  domain={[0, 'dataMax']}
                  tickFormatter={(v: number) => `${v.toFixed(0)}`}
                  stroke="#3f3f46"
                  tick={{ fill: '#71717a', fontSize: 10 }}
                  tickLine={false}
                  minTickGap={28}
                  label={{ value: 'Hz', position: 'insideBottomRight', fill: '#71717a', fontSize: 10, dy: 8 }}
                />
                <YAxis
                  stroke="#3f3f46"
                  tick={{ fill: '#71717a', fontSize: 10 }}
                  tickLine={false}
                  width={36}
                  domain={[0, 1]}
                />
                <Tooltip content={<FftTooltip />} cursor={{ stroke: '#52525b', strokeWidth: 1 }} />
                <ReferenceLine
                  x={fft.dominantHz}
                  stroke="#fbbf24"
                  strokeDasharray="4 3"
                  label={{ value: `${fft.dominantHz} Hz`, fill: '#fbbf24', fontSize: 10, position: 'top' }}
                />
                <Area
                  type="monotone"
                  dataKey={first.axis}
                  stroke={colorOf(first.axis)}
                  strokeWidth={1.6}
                  fill="url(#fft-fill)"
                  isAnimationActive={false}
                />
                {rest.map((ax) => (
                  <Line
                    key={ax.axis}
                    type="monotone"
                    dataKey={ax.axis}
                    stroke={colorOf(ax.axis)}
                    strokeWidth={1.4}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <p className="text-[11px] leading-relaxed text-zinc-500">{fft.note}</p>
              <span className="ml-auto flex shrink-0 items-center gap-3 text-[11px] text-zinc-400">
                {fft.axes.map((ax) => (
                  <span key={ax.axis} className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: colorOf(ax.axis) }} />
                    {ax.axis}
                    <span className="font-mono text-zinc-500">{ax.peakHz}Hz</span>
                  </span>
                ))}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
