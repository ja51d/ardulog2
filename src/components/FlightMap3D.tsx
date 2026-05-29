import { useEffect, useRef, useState, type PointerEvent } from 'react'
import maplibregl from 'maplibre-gl'
import type { SkySpecification } from 'maplibre-gl'
import type { LogAnalysis } from '../data/demoLog'
import { CardTitle } from './ui'
import { exportGpx, exportKml } from '../lib/exportTrack'
import {
  addFlightLayers,
  addPlaybackMarker,
  DEM_TILES,
  pointAtProgress,
  satelliteRasterSource,
  setMarkerProgress,
  trackBounds,
} from '../lib/flightMap'

const SKY: SkySpecification = {
  'sky-color': '#0b1830',
  'horizon-color': '#1e293b',
  'fog-color': '#0a0a12',
  'sky-horizon-blend': 0.6,
  'horizon-fog-blend': 0.5,
  'fog-ground-blend': 0.6,
}

// Playback speeds (× real time). 1× replays at the logged wall-clock rate.
const SPEEDS = [1, 2, 4, 8] as const

const fmtClock = (s: number) => {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

/** Pitched satellite + terrain view — "where it flew", in 3D over real Earth. */
export default function FlightMap3D({ a }: { a: LogAnalysis }) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const rafRef = useRef(0)
  const progRef = useRef(0)
  const barRef = useRef<HTMLDivElement>(null)
  const clockRef = useRef<HTMLSpanElement>(null)
  const altRef = useRef<HTMLSpanElement>(null)
  const spdRef = useRef<HTMLSpanElement>(null)
  const batRef = useRef<HTMLSpanElement>(null)
  const followRef = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<number>(1)
  const [follow, setFollow] = useState(false)
  const durationSec = a.durationSec
  const hasTrack = a.geoPath.length > 1
  const tel = a.telemetry

  // Sample the unified telemetry stream at normalized progress (0–1). geoPath
  // and telemetry both run evenly from arm to disarm, so progress maps cleanly.
  const sampleTel = (p: number) => {
    if (!tel.length) return null
    const f = Math.max(0, Math.min(1, p)) * (tel.length - 1)
    const i = Math.floor(f)
    const j = Math.min(i + 1, tel.length - 1)
    const fr = f - i
    const lerp = (k: 'alt' | 'gspd' | 'vbat') => tel[i][k] + (tel[j][k] - tel[i][k]) * fr
    return { alt: lerp('alt'), gspd: lerp('gspd'), vbat: lerp('vbat') }
  }
  // Push the current sample into the floating HUD (imperative — no re-render).
  const paintHud = (p: number) => {
    const s = sampleTel(p)
    if (!s) return
    if (altRef.current) altRef.current.textContent = s.alt.toFixed(1)
    if (spdRef.current) spdRef.current.textContent = s.gspd.toFixed(1)
    if (batRef.current) batRef.current.textContent = s.vbat.toFixed(1)
  }

  useEffect(() => {
    const el = ref.current
    if (!el || !hasTrack) return
    progRef.current = 0
    setPlaying(false)

    const map = new maplibregl.Map({
      container: el,
      style: {
        version: 8,
        sources: {
          sat: satelliteRasterSource(),
          dem: {
            type: 'raster-dem',
            tiles: [DEM_TILES],
            encoding: 'terrarium',
            tileSize: 256,
            maxzoom: 15,
            attribution: 'Elevation: Tilezen / Mapzen',
          },
        },
        layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
      },
      bounds: trackBounds(a.geoPath),
      fitBoundsOptions: { padding: 70, maxZoom: 17, pitch: 64 },
      maxPitch: 80,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      'top-right',
    )
    map.on('load', () => {
      map.setTerrain({ source: 'dem', exaggeration: 1.5 })
      map.setSky(SKY)
      addFlightLayers(map, a.geoPath)
      addPlaybackMarker(map, a.geoPath)
      paintHud(0)
      // The container is sometimes still settling its final height at init, so
      // re-measure once the style is up to avoid a stunted (default 400×300) canvas.
      map.resize()
      map.fitBounds(trackBounds(a.geoPath), { padding: 70, maxZoom: 17, pitch: 64, duration: 0 })
    })

    // Belt-and-suspenders: catch any post-mount layout settle (page switch /
    // late fonts / scrollbar / the GSAP entrance transform) so the canvas
    // always matches its container. The 600 ms tick lands after the 0.5 s
    // card entrance animation completes.
    const ro = new ResizeObserver(() => map.resize())
    ro.observe(el)
    const raf = requestAnimationFrame(() => map.resize())
    const tids = [120, 350, 600].map((ms) => window.setTimeout(() => map.resize(), ms))
    return () => {
      cancelAnimationFrame(raf)
      cancelAnimationFrame(rafRef.current)
      tids.forEach(clearTimeout)
      ro.disconnect()
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.geoPath, hasTrack])

  // Mirror `follow` into a ref (so scrubbing can read it) and, when it switches
  // on, "lock onto" the aircraft with a quick zoom-in to the current position.
  useEffect(() => {
    followRef.current = follow
    const map = mapRef.current
    if (follow && map && hasTrack) {
      map.easeTo({
        center: pointAtProgress(a.geoPath, progRef.current),
        zoom: Math.max(map.getZoom(), 16),
        duration: 800,
      })
    }
  }, [follow, hasTrack, a.geoPath])

  // Drive the marker along the path while playing — in real time (1×) off the
  // logged duration, scaled by the chosen speed. The camera trails the vehicle
  // when "follow" is on, and the HUD ticks with it.
  useEffect(() => {
    if (!playing) return
    const sweepMs = Math.max(1000, durationSec * 1000) / speed
    let last = performance.now()
    const tick = (now: number) => {
      const map = mapRef.current
      if (!map) return
      const dt = now - last
      last = now
      let p = progRef.current + dt / sweepMs
      if (p > 1) p = 1
      progRef.current = p
      setMarkerProgress(map, a.geoPath, p)
      if (followRef.current) map.setCenter(pointAtProgress(a.geoPath, p))
      if (barRef.current) barRef.current.style.width = `${p * 100}%`
      if (clockRef.current)
        clockRef.current.textContent = `${fmtClock(p * durationSec)} / ${fmtClock(durationSec)}`
      paintHud(p)
      if (p >= 1) {
        setPlaying(false)
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed, durationSec, a.geoPath])

  const togglePlay = () => {
    if (progRef.current >= 1) {
      progRef.current = 0
      if (mapRef.current) setMarkerProgress(mapRef.current, a.geoPath, 0)
      if (barRef.current) barRef.current.style.width = '0%'
      if (clockRef.current) clockRef.current.textContent = `0:00 / ${fmtClock(durationSec)}`
      paintHud(0)
    }
    setPlaying((v) => !v)
  }

  // Click / drag anywhere on the progress bar to seek the playback position.
  const scrub = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const p = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    progRef.current = p
    const map = mapRef.current
    if (map) {
      setMarkerProgress(map, a.geoPath, p)
      if (followRef.current) map.setCenter(pointAtProgress(a.geoPath, p))
    }
    if (barRef.current) barRef.current.style.width = `${p * 100}%`
    if (clockRef.current)
      clockRef.current.textContent = `${fmtClock(p * durationSec)} / ${fmtClock(durationSec)}`
    paintHud(p)
  }

  return (
    <div className="flex h-full flex-col">
      <CardTitle
        title="3D flight view"
        hint="drag to orbit · scroll to zoom"
        icon={
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M12 2 21 7v10l-9 5-9-5V7l9-5Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path d="M12 2v20M3 7l9 5 9-5" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        }
        action={
          hasTrack ? (
            <>
              <button
                type="button"
                onClick={() => exportGpx(a)}
                title="Download GPS track as GPX"
                className="rounded-md bg-white/5 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-zinc-300 ring-1 ring-inset ring-white/10 transition hover:bg-white/10 hover:text-zinc-100"
              >
                GPX
              </button>
              <button
                type="button"
                onClick={() => exportKml(a)}
                title="Download 3D track for Google Earth (KML)"
                className="rounded-md bg-white/5 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-zinc-300 ring-1 ring-inset ring-white/10 transition hover:bg-white/10 hover:text-zinc-100"
              >
                KML
              </button>
            </>
          ) : undefined
        }
      />
      {hasTrack ? (
        <div className="relative w-full overflow-hidden rounded-2xl border border-white/[0.06]">
          <div ref={ref} className="h-[440px] w-full sm:h-[560px] lg:h-[640px]" />

          {/* Live flight HUD — sampled from the recorded telemetry at the
              current playback position. */}
          <div className="pointer-events-none absolute left-3 top-3 flex gap-1.5">
            {[
              { label: 'Alt', ref: altRef, unit: 'm' },
              { label: 'Speed', ref: spdRef, unit: 'm/s' },
              { label: 'Batt', ref: batRef, unit: 'V' },
            ].map((h) => (
              <div
                key={h.label}
                className="rounded-lg border border-white/10 bg-zinc-950/70 px-2.5 py-1.5 backdrop-blur-sm"
              >
                <div className="text-[9px] font-medium uppercase tracking-wider text-zinc-500">
                  {h.label}
                </div>
                <div className="font-mono text-sm tabular-nums text-zinc-100">
                  <span ref={h.ref}>0.0</span>
                  <span className="ml-0.5 text-[10px] text-zinc-500">{h.unit}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-3 rounded-full border border-white/10 bg-zinc-950/70 px-3 py-1.5 text-[11px] text-zinc-300 backdrop-blur-sm">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-sky-400" /> takeoff
            </span>
            <span
              className="h-1 w-10 rounded-full"
              style={{ background: 'linear-gradient(90deg,#38bdf8,#22d3ee,#a855f7)' }}
            />
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-purple-400" /> land
            </span>
          </div>

          {/* Playback: fly the vehicle marker along the track, in real time —
              centred, scrubbable, with an optional chase camera. */}
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-white/10 bg-zinc-950/70 px-2.5 py-1.5 backdrop-blur-sm">
            <button
              type="button"
              onClick={() => setFollow((v) => !v)}
              aria-pressed={follow}
              aria-label="Follow the aircraft with the camera"
              title="Chase camera — keep the aircraft centred"
              className={`flex h-7 items-center gap-1 rounded-full px-2 text-[11px] font-medium transition ${
                follow
                  ? 'bg-sky-500/30 text-sky-200 ring-1 ring-inset ring-sky-400/40'
                  : 'bg-white/10 text-zinc-300 hover:bg-white/20'
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.8" />
                <path
                  d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
              follow
            </button>
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? 'Pause flight playback' : 'Play flight playback'}
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
              className="h-2 w-36 cursor-pointer overflow-hidden rounded-full bg-white/15"
              onPointerDown={scrub}
            >
              <div ref={barRef} className="h-full w-0 rounded-full bg-sky-400" />
            </div>
            <span ref={clockRef} className="font-mono text-[11px] tabular-nums text-zinc-300">
              0:00 / {fmtClock(durationSec)}
            </span>
            <button
              type="button"
              onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s as (typeof SPEEDS)[number]) + 1) % SPEEDS.length])}
              aria-label="Playback speed"
              className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px] text-zinc-100 transition hover:bg-white/20"
            >
              {speed}×
            </button>
          </div>
        </div>
      ) : (
        <div className="flex h-[440px] items-center justify-center rounded-2xl border border-dashed border-white/10 text-center text-xs text-zinc-500 sm:h-[560px] lg:h-[640px]">
          No GPS positions were logged, so the 3D flight view isn't available.
        </div>
      )}
    </div>
  )
}
