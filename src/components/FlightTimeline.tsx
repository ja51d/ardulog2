import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react'
import { gsap, useGSAP } from '../lib/gsap'
import type { LogAnalysis } from '../data/demoLog'
import { CardTitle } from './ui'
import { modeColorClass } from '../lib/modeColors'

const SPEEDS = [1, 2, 4, 8] as const
type Speed = (typeof SPEEDS)[number]

function fmt(totalSec: number) {
  const s = Math.max(0, Math.round(totalSec))
  const m = Math.floor(s / 60)
  return `${m}:${(s % 60).toString().padStart(2, '0')}`
}

type EventKind = 'takeoff' | 'peakAlt' | 'topSpeed' | 'minVolt' | 'landing'

interface FlightEvent {
  t: number
  kind: EventKind
  label: string
  value: string
}

const PIN_DOT: Record<EventKind, string> = {
  takeoff: 'bg-emerald-300',
  landing: 'bg-emerald-300',
  peakAlt: 'bg-sky-300',
  topSpeed: 'bg-cyan-300',
  minVolt: 'bg-amber-300',
}

/** Pick a "nice" minute/second step so the axis shows ~5–8 labels. */
function axisStep(dur: number): number {
  for (const step of [15, 30, 60, 120, 300, 600, 1200]) {
    if (dur / step <= 8) return step
  }
  return 1800
}

function Readout({
  label,
  refEl,
  mono,
}: {
  label: string
  refEl: RefObject<HTMLSpanElement | null>
  mono?: boolean
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
      <div className="text-[9px] font-medium uppercase tracking-[0.14em] text-zinc-600">
        {label}
      </div>
      <span ref={refEl} className={`text-sm text-zinc-200 ${mono ? 'font-mono tabular-nums' : ''}`}>
        —
      </span>
    </div>
  )
}

/**
 * A full-width "flight at a glance" strip: flight-mode bands and an altitude
 * profile under a scrubbable, auto-playing playhead, with auto-detected event
 * pins (takeoff, peak altitude, top speed, voltage sag, landing) and a live
 * telemetry readout. Mode segments come straight from the MODE log; the events
 * are derived from the unified telemetry stream so it works on real logs too.
 */
export default function FlightTimeline({ a }: { a: LogAnalysis }) {
  const dur = Math.max(1, a.durationSec)
  const tel = a.telemetry

  const rootRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const tRef = useRef<HTMLSpanElement>(null)
  const modeRef = useRef<HTMLSpanElement>(null)
  const altRef = useRef<HTMLSpanElement>(null)
  const spdRef = useRef<HTMLSpanElement>(null)
  const vbatRef = useRef<HTMLSpanElement>(null)
  const progRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const draggingRef = useRef(false)

  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<Speed>(1)

  // Mode bands, each with a clamped [start, end] window.
  const segments = useMemo(() => {
    const segs = a.modes.map((m, i) => ({
      name: m.name,
      start: m.start,
      end: Math.max(m.start, i < a.modes.length - 1 ? a.modes[i + 1].start : dur),
    }))
    return segs.length ? segs : [{ name: 'Flight', start: 0, end: dur }]
  }, [a.modes, dur])

  const distinctModes = useMemo(() => [...new Set(segments.map((s) => s.name))], [segments])

  // Altitude profile as a filled SVG path in a 0–100 viewBox (y inverted).
  const altPath = useMemo(() => {
    if (tel.length < 2) return ''
    let lo = Infinity
    let hi = -Infinity
    for (const s of tel) {
      if (s.alt < lo) lo = s.alt
      if (s.alt > hi) hi = s.alt
    }
    const span = hi - lo || 1
    const line = tel
      .map((s, i) => {
        const x = (s.t / dur) * 100
        const y = 100 - ((s.alt - lo) / span) * 92 - 4
        return `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`
      })
      .join(' ')
    return `${line} L100,100 L0,100 Z`
  }, [tel, dur])

  // Auto-detected milestones from the telemetry stream.
  const events = useMemo<FlightEvent[]>(() => {
    if (!tel.length) return []
    const AIR = 1.5
    const evs: FlightEvent[] = []

    const takeoff = tel.find((s) => s.alt >= AIR)
    if (takeoff && takeoff.t > 0.5)
      evs.push({ t: takeoff.t, kind: 'takeoff', label: 'Takeoff', value: fmt(takeoff.t) })

    let landing: (typeof tel)[number] | undefined
    for (let i = tel.length - 1; i >= 0; i--) {
      if (tel[i].alt >= AIR) {
        landing = tel[i]
        break
      }
    }
    if (landing && landing.t < dur - 0.5)
      evs.push({ t: landing.t, kind: 'landing', label: 'Landing', value: fmt(landing.t) })

    let peak = tel[0]
    for (const s of tel) if (s.alt > peak.alt) peak = s
    if (peak.alt >= AIR)
      evs.push({ t: peak.t, kind: 'peakAlt', label: 'Peak alt', value: `${peak.alt.toFixed(0)} m` })

    let fast = tel[0]
    for (const s of tel) if (s.gspd > fast.gspd) fast = s
    if (fast.gspd > 1)
      evs.push({ t: fast.t, kind: 'topSpeed', label: 'Top speed', value: `${fast.gspd.toFixed(1)} m/s` })

    const fromT = takeoff?.t ?? 0
    const toT = landing?.t ?? dur
    let low: (typeof tel)[number] | undefined
    for (const s of tel) {
      if (s.t < fromT || s.t > toT || s.vbat <= 0) continue
      if (!low || s.vbat < low.vbat) low = s
    }
    if (low) evs.push({ t: low.t, kind: 'minVolt', label: 'Min volts', value: `${low.vbat.toFixed(1)} V` })

    return evs.sort((x, y) => x.t - y.t)
  }, [tel, dur])

  const ticks = useMemo(() => {
    const step = axisStep(dur)
    const out: number[] = []
    for (let t = 0; t < dur - step * 0.4; t += step) out.push(t)
    return out
  }, [dur])

  // Linear-interpolate the telemetry channels at time `t`.
  const lerpAt = (t: number): { alt: number; gspd: number; vbat: number } => {
    if (!tel.length) return { alt: 0, gspd: 0, vbat: 0 }
    const first = tel[0]
    const last = tel[tel.length - 1]
    if (t <= first.t) return { alt: first.alt, gspd: first.gspd, vbat: first.vbat }
    if (t >= last.t) return { alt: last.alt, gspd: last.gspd, vbat: last.vbat }
    let lo = 0
    let hi = tel.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (tel[mid].t <= t) lo = mid
      else hi = mid
    }
    const s0 = tel[lo]
    const s1 = tel[hi]
    const f = (t - s0.t) / (s1.t - s0.t || 1)
    return {
      alt: s0.alt + (s1.alt - s0.alt) * f,
      gspd: s0.gspd + (s1.gspd - s0.gspd) * f,
      vbat: s0.vbat + (s1.vbat - s0.vbat) * f,
    }
  }

  const modeAt = (t: number) => {
    let name = segments[0]?.name ?? '—'
    for (const s of segments) {
      if (s.start <= t) name = s.name
      else break
    }
    return name
  }

  // Imperatively move the playhead + repaint readouts (no per-frame re-render).
  const paint = (prog: number) => {
    const t = prog * dur
    if (headRef.current) headRef.current.style.left = `${prog * 100}%`
    const s = lerpAt(t)
    const mode = modeAt(t)
    if (tRef.current) tRef.current.textContent = `T+${fmt(t)}`
    if (modeRef.current) modeRef.current.textContent = mode
    if (altRef.current) altRef.current.textContent = `${s.alt.toFixed(0)} m`
    if (spdRef.current) spdRef.current.textContent = `${s.gspd.toFixed(1)} m/s`
    if (vbatRef.current) vbatRef.current.textContent = s.vbat > 0 ? `${s.vbat.toFixed(1)} V` : '—'
    const track = trackRef.current
    if (track) {
      track.setAttribute('aria-valuenow', String(Math.round(t)))
      track.setAttribute('aria-valuetext', `T+${fmt(t)}, ${mode}, ${s.alt.toFixed(0)} metres`)
    }
  }

  // Reset to the start whenever a new log is loaded.
  useEffect(() => {
    progRef.current = 0
    paint(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a])

  // Drive the playhead while playing; sweep the whole flight in ~dur/speed.
  useEffect(() => {
    if (!playing) return
    const sweepMs = Math.max(1000, dur * 1000) / speed
    let prev = performance.now()
    const tick = (now: number) => {
      const dt = now - prev
      prev = now
      let p = progRef.current + dt / sweepMs
      if (p >= 1) {
        p = 1
        progRef.current = 1
        paint(1)
        setPlaying(false)
        return
      }
      progRef.current = p
      paint(p)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed, dur])

  // Tasteful intro: grow the bands from the left, pop the pins in. Skipped for
  // users who prefer reduced motion.
  useGSAP(
    () => {
      const root = rootRef.current
      if (!root) return
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
      const bands = root.querySelectorAll('[data-band]')
      const pins = root.querySelectorAll('[data-pin]')
      if (bands.length)
        gsap.from(bands, {
          scaleX: 0,
          transformOrigin: 'left center',
          duration: 0.5,
          ease: 'power3.out',
          stagger: 0.06,
        })
      if (pins.length)
        gsap.from(pins, {
          opacity: 0,
          y: -8,
          duration: 0.4,
          ease: 'back.out(1.7)',
          stagger: 0.05,
          delay: 0.25,
        })
    },
    { scope: rootRef, dependencies: [a] },
  )

  const togglePlay = () => {
    if (!playing && progRef.current >= 1) {
      progRef.current = 0
      paint(0)
    }
    setPlaying((p) => !p)
  }

  const cycleSpeed = () => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])

  const scrubFromClientX = (clientX: number) => {
    const el = trackRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const p = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
    progRef.current = p
    paint(p)
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    setPlaying(false)
    draggingRef.current = true
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    scrubFromClientX(e.clientX)
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) scrubFromClientX(e.clientX)
  }

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const step = (e.shiftKey ? 0.05 : 0.01) * (e.key === 'ArrowRight' ? 1 : -1)
      progRef.current = Math.max(0, Math.min(1, progRef.current + step))
      paint(progRef.current)
      setPlaying(false)
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      togglePlay()
    } else if (e.key === 'Home') {
      e.preventDefault()
      progRef.current = 0
      paint(0)
      setPlaying(false)
    } else if (e.key === 'End') {
      e.preventDefault()
      progRef.current = 1
      paint(1)
      setPlaying(false)
    }
  }

  return (
    <div ref={rootRef} className="flex h-full flex-col">
      <CardTitle
        title="Flight timeline"
        hint={`${fmt(dur)} · ${distinctModes.length} mode${distinctModes.length === 1 ? '' : 's'}`}
        icon={
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M3 12h4l3-8 4 16 3-8h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        }
        action={
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? 'Pause playback' : 'Play flight'}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/5 text-zinc-300 ring-1 ring-inset ring-white/10 transition hover:bg-white/10 hover:text-zinc-100"
            >
              {playing ? (
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M8 5.5v13a1 1 0 0 0 1.5.87l11-6.5a1 1 0 0 0 0-1.74l-11-6.5A1 1 0 0 0 8 5.5Z" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={cycleSpeed}
              aria-label={`Playback speed ${speed}×, tap to change`}
              className="rounded-md bg-white/5 px-2 py-1 text-[11px] font-medium tabular-nums text-zinc-300 ring-1 ring-inset ring-white/10 transition hover:bg-white/10 hover:text-zinc-100"
            >
              {speed}×
            </button>
          </div>
        }
      />

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Readout label="Time" refEl={tRef} mono />
        <Readout label="Mode" refEl={modeRef} />
        <Readout label="Altitude" refEl={altRef} mono />
        <Readout label="Speed" refEl={spdRef} mono />
        <Readout label="Battery" refEl={vbatRef} mono />
      </div>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Flight timeline — scrub through the flight"
        aria-valuemin={0}
        aria-valuemax={Math.round(dur)}
        aria-valuenow={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        className="relative mt-1 h-32 w-full cursor-pointer touch-none select-none rounded-xl border border-white/[0.06] bg-white/[0.02]"
      >
        {/* Altitude profile */}
        {altPath && (
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            <defs>
              <linearGradient id="ft-alt" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.32" />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <path d={altPath} fill="url(#ft-alt)" stroke="#7dd3fc" strokeOpacity="0.5" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
          </svg>
        )}

        {/* Event pins */}
        {events.map((ev) => (
          <div
            key={ev.kind + ev.t}
            data-pin
            className="pointer-events-none absolute top-1.5 z-[5] flex -translate-x-1/2 flex-col items-center"
            style={{ left: `${(ev.t / dur) * 100}%` }}
          >
            <span className={`h-2 w-2 rounded-full ring-2 ring-zinc-950 ${PIN_DOT[ev.kind]}`} />
            <span className="my-0.5 h-5 w-px bg-white/15" />
            <span className="whitespace-nowrap text-[9px] font-medium text-zinc-400">{ev.label}</span>
            <span className="whitespace-nowrap text-[9px] tabular-nums text-zinc-600">{ev.value}</span>
          </div>
        ))}

        {/* Mode bands */}
        <div className="absolute inset-x-0 bottom-0 flex h-8 overflow-hidden rounded-b-xl">
          {segments.map((seg) => (
            <div
              key={seg.name + seg.start}
              data-band
              title={`${seg.name} · ${fmt(seg.start)}–${fmt(seg.end)}`}
              className="relative h-full min-w-0 border-r border-zinc-950/40 last:border-r-0"
              style={{ flexGrow: Math.max(seg.end - seg.start, 0.5), flexBasis: 0 }}
            >
              <span className={`absolute inset-0 opacity-80 ${modeColorClass(seg.name)}`} aria-hidden />
              <span className="relative z-10 flex h-full items-center truncate px-1.5 text-[10px] font-semibold text-zinc-950/85">
                {seg.name}
              </span>
            </div>
          ))}
        </div>

        {/* Playhead */}
        <div ref={headRef} className="pointer-events-none absolute inset-y-0 z-20 w-px bg-sky-300" style={{ left: '0%' }}>
          <span className="absolute -left-1.5 -top-1 h-3 w-3 rounded-full bg-sky-300 shadow-[0_0_10px_2px_rgba(56,189,248,0.7)]" />
        </div>
      </div>

      {/* Time axis */}
      <div className="relative mt-1.5 h-3.5 text-[9px] tabular-nums text-zinc-600">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2" style={{ left: `${(t / dur) * 100}%` }}>
            {fmt(t)}
          </span>
        ))}
        <span className="absolute right-0">{fmt(dur)}</span>
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
        {distinctModes.map((name) => (
          <span key={name} className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <span className={`h-2 w-2 rounded-full ${modeColorClass(name)}`} />
            {name}
          </span>
        ))}
      </div>
    </div>
  )
}
