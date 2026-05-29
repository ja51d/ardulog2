import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import type { SkySpecification } from 'maplibre-gl'
import type { LogAnalysis } from '../data/demoLog'
import { CardTitle } from './ui'
import {
  addFlightLayers,
  addPlaybackMarker,
  DEM_TILES,
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

// Wall-clock duration of one full playback sweep along the track.
const SWEEP_MS = 14000

/** Pitched satellite + terrain view — "where it flew", in 3D over real Earth. */
export default function FlightMap3D({ a }: { a: LogAnalysis }) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const rafRef = useRef(0)
  const progRef = useRef(0)
  const barRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const hasTrack = a.geoPath.length > 1

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
  }, [a.geoPath, hasTrack])

  // Drive the marker along the path while playing.
  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    const tick = (now: number) => {
      const map = mapRef.current
      if (!map) return
      const dt = now - last
      last = now
      let p = progRef.current + dt / SWEEP_MS
      if (p > 1) p = 1
      progRef.current = p
      setMarkerProgress(map, a.geoPath, p)
      if (barRef.current) barRef.current.style.width = `${p * 100}%`
      if (p >= 1) {
        setPlaying(false)
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, a.geoPath])

  const togglePlay = () => {
    if (progRef.current >= 1) {
      progRef.current = 0
      if (mapRef.current) setMarkerProgress(mapRef.current, a.geoPath, 0)
      if (barRef.current) barRef.current.style.width = '0%'
    }
    setPlaying((v) => !v)
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
      />
      {hasTrack ? (
        <div className="relative w-full overflow-hidden rounded-2xl border border-white/[0.06]">
          <div ref={ref} className="h-[440px] w-full sm:h-[560px] lg:h-[640px]" />
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

          {/* Playback: fly the vehicle marker along the track. */}
          <div className="absolute bottom-3 right-3 flex items-center gap-2.5 rounded-full border border-white/10 bg-zinc-950/70 px-2.5 py-1.5 backdrop-blur-sm">
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
            <div className="h-1 w-24 overflow-hidden rounded-full bg-white/15">
              <div ref={barRef} className="h-full w-0 rounded-full bg-sky-400" />
            </div>
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
