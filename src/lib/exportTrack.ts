// Client-side flight-track exporters. Everything is built and saved in the
// browser from the already-parsed analysis — nothing is uploaded anywhere.
//   • GPX 1.1 — opens in almost any mapping / GIS tool, with per-point times
//   • KML      — drops the 3D track straight into Google Earth
import type { LogAnalysis } from '../data/demoLog'

const baseName = (a: LogAnalysis) => a.fileName.replace(/\.bin$/i, '') || 'flight'

const esc = (s: string) =>
  s.replace(
    /[<>&'"]/g,
    (c) =>
      (({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }) as Record<string, string>)[c],
  )

/** Parse the human "2026-05-21 14:32 UTC" stamp into epoch ms (UTC). */
function parseLoggedAt(s: string): number {
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})\D+(\d{2}):(\d{2})/)
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0)
  const t = Date.parse(s)
  return Number.isNaN(t) ? Date.now() : t
}

function download(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/** GPS track as GPX 1.1, with timestamps spread across the logged duration. */
export function exportGpx(a: LogAnalysis) {
  const pts = a.geoPath
  if (pts.length < 2) return
  const startMs = parseLoggedAt(a.loggedAt)
  const n = pts.length
  const name = esc(baseName(a))
  const trkpts = pts
    .map(([lng, lat, ele], i) => {
      const t = new Date(startMs + (i / (n - 1)) * a.durationSec * 1000).toISOString()
      return `      <trkpt lat="${lat.toFixed(7)}" lon="${lng.toFixed(7)}"><ele>${ele.toFixed(1)}</ele><time>${t}</time></trkpt>`
    })
    .join('\n')
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="ArduLog" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${name}</name>
    <time>${new Date(startMs).toISOString()}</time>
  </metadata>
  <trk>
    <name>${name}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`
  download(gpx, `${baseName(a)}.gpx`, 'application/gpx+xml')
}

/** 3D track as KML for Google Earth (altitude relative to ground). */
export function exportKml(a: LogAnalysis) {
  const pts = a.geoPath
  if (pts.length < 2) return
  const name = esc(baseName(a))
  const coords = pts
    .map(([lng, lat, ele]) => `${lng.toFixed(7)},${lat.toFixed(7)},${ele.toFixed(1)}`)
    .join(' ')
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${name}</name>
    <Style id="track"><LineStyle><color>fff8bd38</color><width>4</width></LineStyle></Style>
    <Placemark>
      <name>Flight path</name>
      <styleUrl>#track</styleUrl>
      <LineString>
        <extrude>0</extrude>
        <tessellate>1</tessellate>
        <altitudeMode>relativeToGround</altitudeMode>
        <coordinates>${coords}</coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>
`
  download(kml, `${baseName(a)}.kml`, 'application/vnd.google-earth.kml+xml')
}
