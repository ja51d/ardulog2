import type { LogAnalysis } from '../data/demoLog'
import { Badge, CardTitle, Sparkline, Stat } from './ui'
import { SEVERITY_STYLE } from '../lib/severity'

function formatDuration(totalSec: number) {
  const m = Math.floor(totalSec / 60)
  const s = Math.round(totalSec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function FlightSummaryCard({ a }: { a: LogAnalysis }) {
  return (
    <>
      <CardTitle title="Flight summary" hint={a.loggedAt} />
      <div className="mb-5">
        <div className="text-lg font-semibold text-zinc-100">{a.vehicle}</div>
        <div className="text-sm text-zinc-400">
          {a.frame} · {a.firmware}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <Stat value={formatDuration(a.durationSec)} label="Duration" />
        <Stat
          value={(a.distanceM / 1000).toFixed(2)}
          unit="km"
          label="Distance"
        />
        <Stat value={a.maxAltM.toFixed(0)} unit="m" label="Max altitude" />
        <Stat value={a.maxSpeedMs.toFixed(1)} unit="m/s" label="Max speed" />
      </div>
      <div className="mt-auto pt-5">
        <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-500">
          <span>Altitude profile</span>
          <span>{a.maxAltM.toFixed(0)} m peak</span>
        </div>
        <Sparkline data={a.altSeries} className="h-12 w-full" stroke="#38bdf8" />
      </div>
    </>
  )
}

export function BatteryCard({ a }: { a: LogAnalysis }) {
  const b = a.battery
  const usedPct = Math.round((b.capacityUsedmAh / b.capacityFullmAh) * 100)
  const sagSeverity = b.minV / b.cells < 3.5 ? 'critical' : 'warning'
  return (
    <>
      <CardTitle title="Battery" hint={`${b.cells}S`} />
      <div className="flex items-end justify-between">
        <Stat value={b.minV.toFixed(1)} unit="V min" label="Under load" />
        <Badge severity={sagSeverity}>
          {(b.minV / b.cells).toFixed(2)} V/cell
        </Badge>
      </div>
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-[11px] text-zinc-500">
          <span>Capacity used</span>
          <span className="tabular-nums">
            {b.capacityUsedmAh.toLocaleString()} / {b.capacityFullmAh.toLocaleString()} mAh
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-amber-400"
            style={{ width: `${usedPct}%` }}
          />
        </div>
      </div>
      <div className="mt-auto pt-4">
        <Sparkline
          data={b.voltageSeries}
          className="h-10 w-full"
          stroke="#34d399"
        />
        <div className="mt-1 flex justify-between text-[11px] text-zinc-500">
          <span>{b.startV.toFixed(1)} V start</span>
          <span>peak {b.maxCurrentA.toFixed(0)} A</span>
          <span>{b.endV.toFixed(1)} V end</span>
        </div>
      </div>
    </>
  )
}

export function GpsEkfCard({ a }: { a: LogAnalysis }) {
  const g = a.gps
  return (
    <>
      <CardTitle title="GPS & EKF" />
      <div className="grid grid-cols-3 gap-3">
        <Stat value={g.sats} label="Satellites" />
        <Stat value={g.hdop.toFixed(1)} label="HDOP" />
        <Stat value={g.fixType.replace('3D ', '')} label="Fix" />
      </div>
      <div className="mt-auto pt-5">
        <Badge severity={g.ekfStatus}>EKF {SEVERITY_STYLE[g.ekfStatus].label}</Badge>
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">{g.ekfNote}</p>
      </div>
    </>
  )
}

export function VibrationCard({ a }: { a: LogAnalysis }) {
  const v = a.vibe
  const SCALE = 45 // m/s²; ArduPilot warn threshold is 30.
  const axes = [
    { k: 'X', val: v.x },
    { k: 'Y', val: v.y },
    { k: 'Z', val: v.z },
  ]
  return (
    <>
      <CardTitle title="Vibration" hint="warn ≥ 30 m/s²" />
      <div className="space-y-2.5">
        {axes.map(({ k, val }) => {
          const over = val >= 30
          return (
            <div key={k} className="flex items-center gap-3">
              <span className="w-3 text-xs font-medium text-zinc-400">{k}</span>
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                {/* threshold marker */}
                <div
                  className="absolute top-0 h-full w-px bg-white/40"
                  style={{ left: `${(30 / SCALE) * 100}%` }}
                />
                <div
                  className={`h-full rounded-full ${
                    over
                      ? 'bg-gradient-to-r from-amber-400 to-rose-500'
                      : 'bg-gradient-to-r from-sky-500 to-cyan-400'
                  }`}
                  style={{ width: `${Math.min((val / SCALE) * 100, 100)}%` }}
                />
              </div>
              <span className="w-10 text-right text-xs tabular-nums text-zinc-300">
                {val.toFixed(0)}
              </span>
            </div>
          )
        })}
      </div>
      <div className="mt-auto flex items-end justify-between pt-4">
        <div>
          <div className="text-xl font-semibold tabular-nums text-zinc-100">
            {v.clipping}
          </div>
          <div className="text-[11px] text-zinc-500">clipping events</div>
        </div>
        <Sparkline data={v.zSeries} className="h-8 w-24" stroke="#fb7185" fill={false} />
      </div>
    </>
  )
}

export function ProblemsCard({ a }: { a: LogAnalysis }) {
  const criticals = a.problems.filter((p) => p.severity === 'critical').length
  const warnings = a.problems.filter((p) => p.severity === 'warning').length
  return (
    <>
      <CardTitle
        title="Detected problems"
        hint={`${criticals} critical · ${warnings} warnings`}
      />
      <ul className="space-y-3 overflow-y-auto pr-1">
        {a.problems.map((p) => {
          const s = SEVERITY_STYLE[p.severity]
          return (
            <li
              key={p.title}
              className="rounded-2xl border border-white/5 bg-white/[0.02] p-4"
            >
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
                <span className="text-sm font-medium text-zinc-100">
                  {p.title}
                </span>
                <code className="ml-auto rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                  {p.source}
                </code>
              </div>
              <p className="mt-1.5 pl-4 text-xs leading-relaxed text-zinc-400">
                {p.detail}
              </p>
            </li>
          )
        })}
      </ul>
    </>
  )
}

export function RecommendationsCard({ a }: { a: LogAnalysis }) {
  return (
    <>
      <CardTitle title="How to make it better" hint="tuning actions" />
      <div className="grid gap-3 sm:grid-cols-2">
        {a.recommendations.map((r, i) => (
          <div
            key={r.title}
            className="rounded-2xl border border-white/5 bg-white/[0.02] p-4"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500/15 text-[11px] font-semibold text-sky-300">
                {i + 1}
              </span>
              <span className="text-sm font-medium text-zinc-100">
                {r.title}
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
              {r.detail}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {r.params.map((param) => (
                <code
                  key={param}
                  className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-sky-300/90"
                >
                  {param}
                </code>
              ))}
            </div>
            {r.settings && r.settings.length > 0 && (
              <div className="mt-3 space-y-1.5 rounded-xl border border-sky-500/15 bg-sky-500/[0.04] p-2.5">
                <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-sky-300/70">
                  Set in your GCS
                </div>
                {r.settings.map((s) => (
                  <div key={s.name} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]">
                    <code className="font-mono text-zinc-300">{s.name}</code>
                    <span className="text-zinc-600">=</span>
                    <code className="font-mono font-semibold text-sky-300">{s.value}</code>
                    {s.note && <span className="text-zinc-500">— {s.note}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

const MODE_COLORS: Record<string, string> = {
  Stabilize: 'bg-zinc-500',
  AltHold: 'bg-sky-500',
  Loiter: 'bg-cyan-500',
  Auto: 'bg-violet-500',
  RTL: 'bg-amber-500',
  Land: 'bg-emerald-500',
}

export function PowerCard({ a }: { a: LogAnalysis }) {
  const p = a.power
  const avgPct = p.peakW > 0 ? Math.min(100, (p.avgW / p.peakW) * 100) : 0
  return (
    <>
      <CardTitle title="Power & efficiency" hint="from BAT" />
      <div className="grid grid-cols-2 gap-x-6 gap-y-5">
        <Stat value={p.whUsed > 0 ? p.whUsed.toFixed(0) : '—'} unit="Wh" label="Energy used" />
        <Stat
          value={p.mahPerKm > 0 ? p.mahPerKm.toLocaleString() : '—'}
          unit="mAh/km"
          label="Efficiency"
        />
        <Stat value={p.avgW > 0 ? p.avgW.toLocaleString() : '—'} unit="W" label="Avg power" />
        <Stat value={p.peakW > 0 ? p.peakW.toLocaleString() : '—'} unit="W" label="Peak power" />
      </div>
      <div className="mt-auto pt-5">
        <div className="mb-1 flex justify-between text-[11px] text-zinc-500">
          <span>avg vs peak draw</span>
          <span className="tabular-nums">{Math.round(avgPct)}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-sky-500 to-amber-400"
            style={{ width: `${avgPct}%` }}
          />
        </div>
      </div>
    </>
  )
}

export function MotorOutputsCard({ a }: { a: LogAnalysis }) {
  const o = a.outputs
  const LO = 1000
  const HI = 2000
  const pos = (v: number) => Math.min(100, Math.max(0, ((v - LO) / (HI - LO)) * 100))
  const sev = o.imbalancePct >= 15 ? 'critical' : o.imbalancePct >= 8 ? 'warning' : 'good'
  return (
    <>
      <CardTitle title="Motor / servo outputs" hint="PWM µs" />
      {o.channels.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-center text-xs text-zinc-500">
          No RCOU output channels were logged for this flight.
        </div>
      ) : (
        <>
          <div className="space-y-2.5">
            {o.channels.map((c) => (
              <div key={c.label} className="flex items-center gap-3">
                <span className="w-7 shrink-0 text-xs font-medium text-zinc-400">{c.label}</span>
                <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="absolute h-full rounded-full bg-gradient-to-r from-sky-500/80 to-cyan-400/80"
                    style={{
                      left: `${pos(c.min)}%`,
                      width: `${Math.max(2, pos(c.max) - pos(c.min))}%`,
                    }}
                  />
                  <div
                    className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full bg-zinc-50"
                    style={{ left: `${pos(c.avg)}%` }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right text-xs tabular-nums text-zinc-300">
                  {c.avg}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-auto flex items-center gap-3 pt-4">
            {o.imbalancePct > 0 && <Badge severity={sev}>{o.imbalancePct}% spread</Badge>}
            <p className="text-[11px] leading-relaxed text-zinc-400">{o.note}</p>
          </div>
        </>
      )}
    </>
  )
}

export function ModesCard({ a }: { a: LogAnalysis }) {
  const segments = a.modes.map((m, i) => {
    const end = i < a.modes.length - 1 ? a.modes[i + 1].start : a.durationSec
    return { ...m, duration: end - m.start }
  })
  return (
    <>
      <CardTitle title="Flight modes" hint={`${a.modes.length} transitions`} />
      <div className="flex h-3 w-full overflow-hidden rounded-full">
        {segments.map((seg) => (
          <div
            key={seg.name + seg.start}
            className={MODE_COLORS[seg.name] ?? 'bg-zinc-600'}
            style={{ flexGrow: seg.duration }}
            title={`${seg.name} (${seg.duration}s)`}
          />
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
        {a.modes.map((m) => (
          <span key={m.name + m.start} className="flex items-center gap-1.5 text-xs text-zinc-400">
            <span
              className={`h-2 w-2 rounded-full ${MODE_COLORS[m.name] ?? 'bg-zinc-600'}`}
            />
            {m.name}
          </span>
        ))}
      </div>
    </>
  )
}
