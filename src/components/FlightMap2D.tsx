import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import type { LogAnalysis } from '../data/demoLog'
import { CardTitle } from './ui'
import { addFlightLayers, satelliteRasterSource, trackBounds } from '../lib/flightMap'

/** Top-down satellite map of the flown track. */
export default function FlightMap2D({ a }: { a: LogAnalysis }) {
  const ref = useRef<HTMLDivElement>(null)
  const hasTrack = a.geoPath.length > 1

  useEffect(() => {
    const el = ref.current
    if (!el || !hasTrack) return

    const map = new maplibregl.Map({
      container: el,
      style: {
        version: 8,
        sources: { sat: satelliteRasterSource() },
        layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
      },
      bounds: trackBounds(a.geoPath),
      fitBoundsOptions: { padding: 40, maxZoom: 18 },
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('load', () => {
      addFlightLayers(map, a.geoPath)
      // Re-measure once styled — the container may still be settling its height,
      // which would otherwise leave a stunted (default 400×300) canvas.
      map.resize()
      map.fitBounds(trackBounds(a.geoPath), { padding: 40, maxZoom: 18, duration: 0 })
    })

    // Catch any post-mount layout settle (page switch / late fonts / scrollbar /
    // the GSAP entrance transform). The 600 ms tick lands after the 0.5 s card
    // entrance animation completes.
    const ro = new ResizeObserver(() => map.resize())
    ro.observe(el)
    const raf = requestAnimationFrame(() => map.resize())
    const tids = [120, 350, 600].map((ms) => window.setTimeout(() => map.resize(), ms))
    return () => {
      cancelAnimationFrame(raf)
      tids.forEach(clearTimeout)
      ro.disconnect()
      map.remove()
    }
  }, [a.geoPath, hasTrack])

  return (
    <div className="flex h-full flex-col">
      <CardTitle
        title="Flight map"
        hint="satellite · scroll to zoom"
        icon={
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M9 3 3 5v16l6-2 6 2 6-2V3l-6 2-6-2Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path d="M9 3v16m6-14v16" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        }
      />
      {hasTrack ? (
        <div className="relative w-full overflow-hidden rounded-2xl border border-white/[0.06]">
          <div ref={ref} className="h-[360px] w-full sm:h-[460px] lg:h-[540px]" />
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
        </div>
      ) : (
        <div className="flex h-[360px] flex-1 items-center justify-center rounded-2xl border border-dashed border-white/10 text-center text-xs text-zinc-500 sm:h-[460px] lg:h-[540px]">
          No GPS positions were logged, so the flight can't be mapped.
        </div>
      )}
    </div>
  )
}
