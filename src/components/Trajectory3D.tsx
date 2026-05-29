import { useEffect, useMemo, useRef, useState } from 'react'
import type { LogAnalysis } from '../data/demoLog'
import { CardTitle } from './ui'

// Wall-clock duration of one full playback sweep along the track.
const SWEEP_MS = 14000

// Gradient stops (sky → cyan → violet), matching the satellite maps.
const STOPS: [number, number, number][] = [
  [0x38, 0xbd, 0xf8],
  [0x22, 0xd3, 0xee],
  [0xa8, 0x55, 0xf7],
]

/** Colour along the sky→cyan→violet ramp at normalized progress (0–1). */
function ramp(t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(x))
  const f = x - i
  const a = STOPS[i]
  const b = STOPS[i + 1]
  const r = Math.round(a[0] + (b[0] - a[0]) * f)
  const g = Math.round(a[1] + (b[1] - a[1]) * f)
  const bl = Math.round(a[2] + (b[2] - a[2]) * f)
  return `rgb(${r},${g},${bl})`
}

/** A "nice" grid step (1/2/5 × 10ⁿ) that splits `span` into ~`target` cells. */
function niceStep(span: number, target = 6): number {
  const raw = span / target
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  if (norm >= 5) return 5 * mag
  if (norm >= 2) return 2 * mag
  return mag
}

function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`
}

/**
 * Map-less 3D trajectory: the flown path rendered as a glowing ribbon over a
 * ground grid, with drop-lines for altitude, orbit-on-drag, and a playback
 * sweep that flies a marker along the track while reading out live altitude
 * and distance. Pure 2D-canvas orthographic projection — no basemap, no WebGL.
 */
export default function Trajectory3D({ a }: { a: LogAnalysis }) {
  const path = a.flightPath
  const hasPath = path.length > 1

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const altRef = useRef<HTMLSpanElement>(null)
  const distRef = useRef<HTMLSpanElement>(null)
  const drawRef = useRef<(() => void) | null>(null)
  const rafRef = useRef(0)
  const progRef = useRef(0)
  const azRef = useRef((-35 * Math.PI) / 180)
  const elRef = useRef((24 * Math.PI) / 180)
  const [playing, setPlaying] = useState(false)

  // Bounding box, centroid, framing radius and cumulative ground distance —
  // all stable for a given flight, so the camera scale never "breathes".
  const geo = useMemo(() => {
    if (path.length < 2) return null
    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity
    let minZ = Infinity, maxZ = -Infinity
    for (const [x, y, z] of path) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const cz = (minZ + maxZ) / 2
    let radius = 1
    for (const [x, y, z] of path) {
      const d = Math.hypot(x - cx, y - cy, z - cz)
      if (d > radius) radius = d
    }
    const cum = [0]
    let total = 0
    for (let i = 1; i < path.length; i++) {
      const [x0, , z0] = path[i - 1]
      const [x1, , z1] = path[i]
      total += Math.hypot(x1 - x0, z1 - z0)
      cum.push(total)
    }
    return { minX, maxX, minY, maxY, minZ, maxZ, cx, cy, cz, radius, cum, total, maxAlt: maxY }
  }, [path])

  // Position / altitude / distance interpolated at normalized progress p.
  const sampleAt = useMemo(() => {
    return (p: number) => {
      const n = path.length
      const f = Math.max(0, Math.min(1, p)) * (n - 1)
      const i = Math.min(n - 2, Math.floor(f))
      const fr = f - i
      const [x0, y0, z0] = path[i]
      const [x1, y1, z1] = path[i + 1]
      const cum = geo ? geo.cum : [0]
      const dist = cum[i] + (cum[i + 1] - cum[i]) * fr
      return {
        x: x0 + (x1 - x0) * fr,
        y: y0 + (y1 - y0) * fr,
        z: z0 + (z1 - z0) * fr,
        alt: y0 + (y1 - y0) * fr,
        dist,
      }
    }
  }, [path, geo])

  useEffect(() => {
    const cv = canvasRef.current
    const wrap = wrapRef.current
    if (!cv || !wrap || !geo) return
    const ctx = cv.getContext('2d')
    if (!ctx) return

    const draw = () => {
      const cw = wrap.clientWidth
      const ch = wrap.clientHeight
      if (cw === 0 || ch === 0) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) {
        cv.width = Math.round(cw * dpr)
        cv.height = Math.round(ch * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cw, ch)

      // Depth backdrop.
      const bg = ctx.createRadialGradient(cw / 2, ch * 0.4, 0, cw / 2, ch * 0.4, Math.max(cw, ch) * 0.8)
      bg.addColorStop(0, '#0c1424')
      bg.addColorStop(1, '#05070e')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, cw, ch)

      const az = azRef.current
      const el = elRef.current
      const ca = Math.cos(az)
      const sa = Math.sin(az)
      const ce = Math.cos(el)
      const se = Math.sin(el)
      const scale = (Math.min(cw, ch) * 0.42) / geo.radius
      const project = (x: number, y: number, z: number): [number, number] => {
        const dx = x - geo.cx
        const dy = y - geo.cy
        const dz = z - geo.cz
        const x1 = dx * ca + dz * sa
        const z1 = -dx * sa + dz * ca
        const sy = dy * ce - z1 * se
        return [cw / 2 + x1 * scale, ch / 2 - sy * scale]
      }

      const gy = geo.minY

      // Ground grid on the XZ plane at the lowest altitude.
      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(148,163,184,0.12)'
      const stepX = niceStep(geo.maxX - geo.minX)
      const stepZ = niceStep(geo.maxZ - geo.minZ)
      for (let x = Math.ceil(geo.minX / stepX) * stepX; x <= geo.maxX; x += stepX) {
        const [ax, ay] = project(x, gy, geo.minZ)
        const [bx, by] = project(x, gy, geo.maxZ)
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
        ctx.stroke()
      }
      for (let z = Math.ceil(geo.minZ / stepZ) * stepZ; z <= geo.maxZ; z += stepZ) {
        const [ax, ay] = project(geo.minX, gy, z)
        const [bx, by] = project(geo.maxX, gy, z)
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
        ctx.stroke()
      }
      // Brighter ground frame.
      ctx.strokeStyle = 'rgba(148,163,184,0.25)'
      const f00 = project(geo.minX, gy, geo.minZ)
      const f10 = project(geo.maxX, gy, geo.minZ)
      const f11 = project(geo.maxX, gy, geo.maxZ)
      const f01 = project(geo.minX, gy, geo.maxZ)
      ctx.beginPath()
      ctx.moveTo(f00[0], f00[1])
      ctx.lineTo(f10[0], f10[1])
      ctx.lineTo(f11[0], f11[1])
      ctx.lineTo(f01[0], f01[1])
      ctx.closePath()
      ctx.stroke()

      // Faint drop-lines from the track down to the ground (altitude cue).
      ctx.strokeStyle = 'rgba(56,189,248,0.10)'
      const dropEvery = Math.max(1, Math.round(path.length / 48))
      for (let i = 0; i < path.length; i += dropEvery) {
        const [x, y, z] = path[i]
        const [ax, ay] = project(x, y, z)
        const [bx, by] = project(x, gy, z)
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
        ctx.stroke()
      }

      // Flight ribbon: wide translucent glow, then crisp gradient core.
      const n = path.length
      const pts = path.map(([x, y, z]) => project(x, y, z))
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.globalAlpha = 0.32
      ctx.lineWidth = 8
      for (let i = 1; i < n; i++) {
        ctx.strokeStyle = ramp((i - 0.5) / (n - 1))
        ctx.beginPath()
        ctx.moveTo(pts[i - 1][0], pts[i - 1][1])
        ctx.lineTo(pts[i][0], pts[i][1])
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      ctx.lineWidth = 2.5
      for (let i = 1; i < n; i++) {
        ctx.strokeStyle = ramp((i - 0.5) / (n - 1))
        ctx.beginPath()
        ctx.moveTo(pts[i - 1][0], pts[i - 1][1])
        ctx.lineTo(pts[i][0], pts[i][1])
        ctx.stroke()
      }

      // Start / end markers.
      const dot = (sx: number, sy: number, fill: string) => {
        ctx.beginPath()
        ctx.arc(sx, sy, 5, 0, Math.PI * 2)
        ctx.fillStyle = fill
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = '#09090b'
        ctx.stroke()
      }
      dot(pts[0][0], pts[0][1], '#38bdf8')
      dot(pts[n - 1][0], pts[n - 1][1], '#a855f7')

      // Live vehicle marker at the current playback position.
      const s = sampleAt(progRef.current)
      const [mx, my] = project(s.x, s.y, s.z)
      const [gx, gyy] = project(s.x, gy, s.z)
      ctx.setLineDash([3, 4])
      ctx.strokeStyle = 'rgba(248,250,252,0.4)'
      ctx.lineWidth = 1.25
      ctx.beginPath()
      ctx.moveTo(mx, my)
      ctx.lineTo(gx, gyy)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.arc(mx, my, 12, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(248,250,252,0.45)'
      ctx.fill()
      ctx.beginPath()
      ctx.arc(mx, my, 5, 0, Math.PI * 2)
      ctx.fillStyle = '#f8fafc'
      ctx.fill()
      ctx.lineWidth = 2.5
      ctx.strokeStyle = '#0ea5e9'
      ctx.stroke()

      // Live readouts + progress bar.
      if (altRef.current) altRef.current.textContent = `${Math.round(s.alt)} m`
      if (distRef.current) distRef.current.textContent = fmtDist(s.dist)
      if (barRef.current) barRef.current.style.width = `${progRef.current * 100}%`
    }

    drawRef.current = draw
    draw()

    const ro = new ResizeObserver(() => draw())
    ro.observe(wrap)
    const raf = requestAnimationFrame(draw)
    const tids = [120, 350, 600].map((ms) => window.setTimeout(draw, ms))

    // Orbit on drag.
    let dragging = false
    let sx = 0
    let sy = 0
    let az0 = 0
    let el0 = 0
    const onDown = (e: PointerEvent) => {
      dragging = true
      sx = e.clientX
      sy = e.clientY
      az0 = azRef.current
      el0 = elRef.current
      cv.setPointerCapture(e.pointerId)
      cv.style.cursor = 'grabbing'
    }
    const onMove = (e: PointerEvent) => {
      if (!dragging) return
      azRef.current = az0 - (e.clientX - sx) * 0.008
      const next = el0 + (e.clientY - sy) * 0.006
      elRef.current = Math.max(-0.17, Math.min(1.4, next))
      draw()
    }
    const onUp = (e: PointerEvent) => {
      dragging = false
      cv.releasePointerCapture(e.pointerId)
      cv.style.cursor = 'grab'
    }
    cv.addEventListener('pointerdown', onDown)
    cv.addEventListener('pointermove', onMove)
    cv.addEventListener('pointerup', onUp)
    cv.addEventListener('pointercancel', onUp)

    return () => {
      cancelAnimationFrame(raf)
      tids.forEach(clearTimeout)
      ro.disconnect()
      cv.removeEventListener('pointerdown', onDown)
      cv.removeEventListener('pointermove', onMove)
      cv.removeEventListener('pointerup', onUp)
      cv.removeEventListener('pointercancel', onUp)
      drawRef.current = null
    }
  }, [geo, path, sampleAt])

  // Fly the marker along the track while playing.
  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    const tick = (now: number) => {
      const dt = now - last
      last = now
      let p = progRef.current + dt / SWEEP_MS
      if (p > 1) p = 1
      progRef.current = p
      drawRef.current?.()
      if (p >= 1) {
        setPlaying(false)
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing])

  const togglePlay = () => {
    if (progRef.current >= 1) {
      progRef.current = 0
      drawRef.current?.()
    }
    setPlaying((v) => !v)
  }

  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    progRef.current = p
    drawRef.current?.()
  }

  return (
    <div className="flex h-full flex-col">
      <CardTitle
        title="3D trajectory"
        hint="drag to orbit · no basemap"
        icon={
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M3 17 12 4l9 13" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M3 17h18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="12" cy="4" r="1.6" fill="currentColor" />
          </svg>
        }
      />
      {hasPath ? (
        <div className="relative w-full overflow-hidden rounded-2xl border border-white/[0.06] bg-[#05070e]">
          <div ref={wrapRef} className="h-[440px] w-full sm:h-[560px] lg:h-[640px]">
            <canvas
              ref={canvasRef}
              className="h-full w-full touch-none"
              style={{ cursor: 'grab' }}
            />
          </div>

          {/* Live altitude / distance callouts. */}
          <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1.5">
            <span className="flex items-baseline gap-1.5 rounded-full border border-white/10 bg-zinc-950/70 px-3 py-1.5 text-[11px] text-zinc-300 backdrop-blur-sm">
              <span className="h-2 w-2 rounded-full bg-sky-400" /> altitude
              <span ref={altRef} className="font-mono text-sm font-semibold text-zinc-50">
                0 m
              </span>
            </span>
            <span className="flex items-baseline gap-1.5 rounded-full border border-white/10 bg-zinc-950/70 px-3 py-1.5 text-[11px] text-zinc-300 backdrop-blur-sm">
              <span className="h-2 w-2 rounded-full bg-purple-400" /> distance
              <span ref={distRef} className="font-mono text-sm font-semibold text-zinc-50">
                0 m
              </span>
            </span>
          </div>

          {/* Peak / total reference. */}
          <div className="pointer-events-none absolute right-3 top-3 rounded-full border border-white/10 bg-zinc-950/70 px-3 py-1.5 text-[11px] text-zinc-400 backdrop-blur-sm">
            peak {geo ? Math.round(geo.maxAlt) : 0} m · track {geo ? fmtDist(geo.total) : '0 m'}
          </div>

          {/* Playback. */}
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-white/10 bg-zinc-950/70 px-2.5 py-1.5 backdrop-blur-sm">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? 'Pause trajectory playback' : 'Play trajectory playback'}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-zinc-100 transition hover:bg-white/20"
            >
              {playing ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M8 5v14l11-7L8 5Z" />
                </svg>
              )}
            </button>
            <div
              className="h-2 w-40 cursor-pointer overflow-hidden rounded-full bg-white/15"
              onPointerDown={scrub}
            >
              <div ref={barRef} className="h-full w-0 rounded-full bg-sky-400" />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex h-[440px] items-center justify-center rounded-2xl border border-dashed border-white/10 text-center text-xs text-zinc-500 sm:h-[560px] lg:h-[640px]">
          No 3D position data was logged, so the trajectory can't be reconstructed.
        </div>
      )}
    </div>
  )
}
