// Shared MapLibre helpers for the satellite flight maps (2D + 3D). Tile
// sources are keyless and CORS-enabled so nothing needs an account/token:
//   • Esri World Imagery — global satellite raster
//   • AWS "terrarium" DEM — global elevation for the 3D terrain view
import 'maplibre-gl/dist/maplibre-gl.css'
import maplibregl from 'maplibre-gl'
import type {
  ExpressionSpecification,
  LngLatBoundsLike,
  Map as MlMap,
  RasterSourceSpecification,
} from 'maplibre-gl'

export const SAT_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
export const DEM_TILES =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
export const SAT_ATTRIB = 'Imagery © Esri, Maxar, Earthstar Geographics'

// Sky → cyan → violet, walked along the path by normalized progress.
const GRADIENT: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['line-progress'],
  0,
  '#38bdf8',
  0.5,
  '#22d3ee',
  1,
  '#a855f7',
]

export function satelliteRasterSource(): RasterSourceSpecification {
  return {
    type: 'raster',
    tiles: [SAT_TILES],
    tileSize: 256,
    maxzoom: 19,
    attribution: SAT_ATTRIB,
  }
}

type Geo = [number, number, number][]

function lineFeature(geoPath: Geo) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: geoPath.map(([lng, lat]) => [lng, lat]),
    },
  }
}

function endpointCollection(geoPath: Geo) {
  const first = geoPath[0]
  const last = geoPath[geoPath.length - 1]
  return {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        properties: { role: 'start' },
        geometry: { type: 'Point' as const, coordinates: [first[0], first[1]] },
      },
      {
        type: 'Feature' as const,
        properties: { role: 'end' },
        geometry: { type: 'Point' as const, coordinates: [last[0], last[1]] },
      },
    ],
  }
}

/** Bounding box of the whole track, for the initial camera framing. */
export function trackBounds(geoPath: Geo): LngLatBoundsLike {
  const b = new maplibregl.LngLatBounds(
    [geoPath[0][0], geoPath[0][1]],
    [geoPath[0][0], geoPath[0][1]],
  )
  for (const [lng, lat] of geoPath) b.extend([lng, lat])
  return b
}

/** Add the glowing gradient flight-path + start/end markers to a loaded map. */
export function addFlightLayers(map: MlMap, geoPath: Geo) {
  map.addSource('flight', {
    type: 'geojson',
    lineMetrics: true,
    data: lineFeature(geoPath),
  })
  map.addSource('ends', { type: 'geojson', data: endpointCollection(geoPath) })

  // Wide, blurred underlay → neon glow.
  map.addLayer({
    id: 'flight-glow',
    type: 'line',
    source: 'flight',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-width': 11,
      'line-blur': 7,
      'line-opacity': 0.45,
      'line-gradient': GRADIENT,
    },
  })
  // Crisp core line on top.
  map.addLayer({
    id: 'flight-line',
    type: 'line',
    source: 'flight',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-width': 3, 'line-gradient': GRADIENT },
  })
  map.addLayer({
    id: 'flight-ends',
    type: 'circle',
    source: 'ends',
    paint: {
      'circle-radius': 6,
      'circle-color': [
        'match',
        ['get', 'role'],
        'start',
        '#38bdf8',
        'end',
        '#a855f7',
        '#ffffff',
      ] as unknown as ExpressionSpecification,
      'circle-stroke-color': '#09090b',
      'circle-stroke-width': 2,
    },
  })
}
