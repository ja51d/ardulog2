import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import type { SkySpecification } from 'maplibre-gl'
import type { LogAnalysis } from '../data/demoLog'
import { CardTitle } from './ui'
import {
  addFlightLayers,
  DEM_TILES,
  satelliteRasterSource,
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

/** Pitched satellite + terrain view — "where it flew", in 3D over real Earth. */
export default function FlightMap3D({ a }: { a: LogAnalysis }) {
  const ref = useRef<HTMLDivElement>(null)
  const hasTrack = a.geoPath.length > 1

  useEffect(() => {
    const el = ref.current
    if (!el || !hasTrack) return

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
      cooperativeGestures: true,
    })
    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      'top-right',
    )
    map.on('load', () => {
      map.setTerrain({ source: 'dem', exaggeration: 1.5 })
      map.setSky(SKY)
      addFlightLayers(map, a.geoPath)
    })

    const ro = new ResizeObserver(() => map.resize())
    ro.observe(el)
    return () => {
      ro.disconnect()
      map.remove()
    }
  }, [a.geoPath, hasTrack])

  return (
    <div className="flex h-full flex-col">
      <CardTitle
        title="3D flight view"
        hint="drag to orbit · satellite + terrain"
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
        <div className="relative h-[360px] w-full overflow-hidden rounded-2xl border border-white/[0.06] sm:h-[440px] lg:h-[520px]">
          <div ref={ref} className="absolute inset-0" />
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
        <div className="flex h-[360px] items-center justify-center rounded-2xl border border-dashed border-white/10 text-center text-xs text-zinc-500 sm:h-[440px] lg:h-[520px]">
          No GPS positions were logged, so the 3D flight view isn't available.
        </div>
      )}
    </div>
  )
}
