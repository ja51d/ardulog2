// Real ArduPilot DataFlash (.bin) parser.
//
// The DataFlash format is self-describing: the log opens with FMT messages that
// declare the byte layout (format string + column labels) of every other
// message type. We bootstrap the one fixed format (FMT itself, type 128), learn
// the rest from the stream, then decode each record by the layout its FMT
// announced. That makes the parser vehicle-agnostic — Plane, Copter and Rover
// logs all decode through the same path; only the message/field *mapping* below
// is opinionated.

import type {
  LogAnalysis,
  ModeSegment,
  Problem,
  Recommendation,
  Severity,
  TelemetrySample,
} from './demoLog'

const HEAD1 = 0xa3
const HEAD2 = 0x95
const FMT_TYPE = 128

interface Fmt {
  type: number
  length: number // total message length, including the 3-byte header
  name: string
  format: string
  columns: string[]
}

type Cell = number | string | number[]
type Row = Record<string, Cell>

// Byte width of each format character (see AP_Logger/LogStructure.h).
const SIZE: Record<string, number> = {
  a: 64, b: 1, B: 1, h: 2, H: 2, i: 4, I: 4, f: 4, d: 8,
  n: 4, N: 16, Z: 64, c: 2, C: 2, e: 4, E: 4, L: 4, M: 1, q: 8, Q: 8,
}

function readString(bytes: Uint8Array, off: number, len: number): string {
  let s = ''
  for (let i = off; i < off + len; i++) {
    const b = bytes[i]
    if (b === 0) break
    s += String.fromCharCode(b)
  }
  return s
}

function decodeField(
  view: DataView,
  bytes: Uint8Array,
  off: number,
  ch: string,
): { value: Cell; size: number } {
  switch (ch) {
    case 'b': return { value: view.getInt8(off), size: 1 }
    case 'B': case 'M': return { value: view.getUint8(off), size: 1 }
    case 'h': return { value: view.getInt16(off, true), size: 2 }
    case 'H': return { value: view.getUint16(off, true), size: 2 }
    case 'i': return { value: view.getInt32(off, true), size: 4 }
    case 'I': return { value: view.getUint32(off, true), size: 4 }
    case 'f': return { value: view.getFloat32(off, true), size: 4 }
    case 'd': return { value: view.getFloat64(off, true), size: 8 }
    // Fixed-point format chars carry an implied /100 (LogStructure.h).
    case 'c': return { value: view.getInt16(off, true) * 0.01, size: 2 }
    case 'C': return { value: view.getUint16(off, true) * 0.01, size: 2 }
    case 'e': return { value: view.getInt32(off, true) * 0.01, size: 4 }
    case 'E': return { value: view.getUint32(off, true) * 0.01, size: 4 }
    case 'L': return { value: view.getInt32(off, true) * 1e-7, size: 4 } // lat/lng degrees
    case 'q': return { value: Number(view.getBigInt64(off, true)), size: 8 }
    case 'Q': return { value: Number(view.getBigUint64(off, true)), size: 8 }
    case 'n': return { value: readString(bytes, off, 4), size: 4 }
    case 'N': return { value: readString(bytes, off, 16), size: 16 }
    case 'Z': return { value: readString(bytes, off, 64), size: 64 }
    case 'a': {
      const arr: number[] = []
      for (let i = 0; i < 32; i++) arr.push(view.getInt16(off + i * 2, true))
      return { value: arr, size: 64 }
    }
    default: return { value: 0, size: SIZE[ch] ?? 0 }
  }
}

interface ParsedLog {
  byType: Map<string, Row[]>
  messageCount: number
}

function parseMessages(buffer: ArrayBuffer): ParsedLog {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const n = bytes.length

  const formats = new Map<number, Fmt>()
  formats.set(FMT_TYPE, {
    type: FMT_TYPE,
    length: 89,
    name: 'FMT',
    format: 'BBnNZ',
    columns: ['Type', 'Length', 'Name', 'Format', 'Labels'],
  })

  const byType = new Map<string, Row[]>()
  let messageCount = 0
  let p = 0

  while (p + 3 <= n) {
    if (bytes[p] !== HEAD1 || bytes[p + 1] !== HEAD2) {
      p++ // resync: scan forward for the next valid header
      continue
    }
    const type = bytes[p + 2]
    const fmt = formats.get(type)
    if (!fmt) {
      p++ // header bytes that don't precede a known type — keep scanning
      continue
    }

    const bodyLen = fmt.length - 3
    if (bodyLen < 0 || p + 3 + bodyLen > n) break // truncated tail

    const row: Row = {}
    let off = p + 3
    let ok = true
    for (let c = 0; c < fmt.columns.length; c++) {
      const ch = fmt.format[c]
      const { value, size } = decodeField(view, bytes, off, ch)
      if (size === 0) { ok = false; break } // unknown char — can't decode, but still skip the record
      row[fmt.columns[c]] = value
      off += size
    }

    if (ok) {
      if (type === FMT_TYPE) {
        // The trailing field holds the comma-separated column labels. Logs name
        // it inconsistently ("Labels" on some versions, "Columns" on others) —
        // read whichever is present.
        const labels = typeof row.Labels === 'string' ? row.Labels : row.Columns
        const cols = String(labels).split(',').filter(Boolean)
        const len = Number(row.Length)
        const newType = Number(row.Type)
        // Never overwrite the canonical FMT(128) layout: its structure is fixed
        // by the format spec, and letting the log's self-description rename the
        // trailing field would corrupt the decode of every later FMT record.
        if (cols.length > 0 && len >= 3 && newType !== FMT_TYPE) {
          formats.set(newType, {
            type: newType,
            length: len,
            name: String(row.Name),
            format: String(row.Format),
            columns: cols,
          })
        }
      } else {
        let arr = byType.get(fmt.name)
        if (!arr) { arr = []; byType.set(fmt.name, arr) }
        arr.push(row)
        messageCount++
      }
    }
    p += 3 + bodyLen
  }

  return { byType, messageCount }
}

// ---------------------------------------------------------------------------
// Analysis builder: map decoded messages onto the LogAnalysis shape the UI
// already consumes. Every lookup degrades gracefully when a message or field
// is absent, so partial / unusual logs still produce a usable analysis.
// ---------------------------------------------------------------------------

const r2 = (n: number) => Math.round(n * 100) / 100
const num = (v: Cell | undefined): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : NaN

/** Pull (time, value) pairs for a field, dropping non-finite rows. */
function series(
  rows: Row[] | undefined,
  vKey: string,
  filter?: (r: Row) => boolean,
): [number, number][] {
  if (!rows) return []
  const out: [number, number][] = []
  for (const r of rows) {
    if (filter && !filter(r)) continue
    const t = num(r.TimeUS)
    const v = num(r[vKey])
    if (Number.isFinite(t) && Number.isFinite(v)) out.push([t, v])
  }
  return out
}

/** Like `series` but prefers instance/core 0, falling back to all instances. */
function series0(
  rows: Row[] | undefined,
  vKey: string,
  instKey: string,
): [number, number][] {
  const primary = series(rows, vKey, (r) => num(r[instKey]) === 0)
  return primary.length ? primary : series(rows, vKey)
}

/** Linear-interpolate a sparse, time-sorted series onto target times (µs). */
function resample(samples: [number, number][], times: number[]): number[] {
  if (samples.length === 0) return times.map(() => 0)
  const out: number[] = []
  let j = 0
  for (const t of times) {
    while (j < samples.length - 1 && samples[j + 1][0] <= t) j++
    const [t0, v0] = samples[j]
    if (j >= samples.length - 1 || t <= t0) {
      out.push(v0)
      continue
    }
    const [t1, v1] = samples[j + 1]
    out.push(t1 > t0 ? v0 + ((v1 - v0) * (t - t0)) / (t1 - t0) : v0)
  }
  return out
}

function downsample(values: number[], count: number): number[] {
  if (values.length <= count) return values.map(r2)
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    out.push(r2(values[Math.round((i * (values.length - 1)) / (count - 1))]))
  }
  return out
}

const max = (s: [number, number][]) => s.reduce((m, [, v]) => (v > m ? v : m), -Infinity)
const min = (s: [number, number][]) => s.reduce((m, [, v]) => (v < m ? v : m), Infinity)

const PLANE_MODES: Record<number, string> = {
  0: 'Manual', 1: 'Circle', 2: 'Stabilize', 3: 'Training', 4: 'Acro', 5: 'FBWA',
  6: 'FBWB', 7: 'Cruise', 8: 'Autotune', 10: 'Auto', 11: 'RTL', 12: 'Loiter',
  13: 'Takeoff', 14: 'Avoid ADSB', 15: 'Guided', 16: 'Initialising',
  17: 'QStabilize', 18: 'QHover', 19: 'QLoiter', 20: 'QLand', 21: 'QRTL',
  22: 'QAutotune', 23: 'QAcro', 24: 'Thermal', 25: 'Loiter to QLand',
}
const COPTER_MODES: Record<number, string> = {
  0: 'Stabilize', 1: 'Acro', 2: 'AltHold', 3: 'Auto', 4: 'Guided', 5: 'Loiter',
  6: 'RTL', 7: 'Circle', 9: 'Land', 11: 'Drift', 13: 'Sport', 14: 'Flip',
  15: 'AutoTune', 16: 'PosHold', 17: 'Brake', 18: 'Throw', 19: 'Avoid ADSB',
  20: 'Guided NoGPS', 21: 'Smart RTL', 22: 'FlowHold', 23: 'Follow', 24: 'ZigZag',
  25: 'SystemID', 27: 'Auto RTL',
}
const ROVER_MODES: Record<number, string> = {
  0: 'Manual', 1: 'Acro', 3: 'Steering', 4: 'Hold', 5: 'Loiter', 6: 'Follow',
  7: 'Simple', 10: 'Auto', 11: 'RTL', 12: 'Smart RTL', 15: 'Guided', 16: 'Initialising',
}

function gpsToDate(gwk: number, gms: number): string {
  // GPS epoch 1980-01-06, currently 18 leap seconds ahead of UTC.
  const unix = 315964800 + gwk * 604800 + gms / 1000 - 18
  const d = new Date(unix * 1000)
  const y = d.getUTCFullYear()
  if (y < 2000 || y > 2100) return '—'
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${y}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())} UTC`
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = Math.PI / 180
  const dLat = (lat2 - lat1) * toRad
  const dLng = (lng2 - lng1) * toRad
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function parseBinLog(buffer: ArrayBuffer, fileName: string): LogAnalysis {
  const { byType, messageCount } = parseMessages(buffer)
  if (messageCount === 0) {
    throw new Error('No ArduPilot log messages found — is this a DataFlash .bin?')
  }
  const get = (t: string) => byType.get(t)

  // --- Vehicle / firmware / frame from MSG + VER ---------------------------
  const msgs = (get('MSG') ?? []).map((r) => String(r.Message ?? ''))
  const verMsg = (get('VER') ?? [])[0]
  let vehicle = 'ArduPilot'
  let firmware = msgs.find((m) => /Ardu(Plane|Copter|Rover|Sub)|APM:/i.test(m)) ?? ''
  if (verMsg && typeof verMsg.FwString === 'string' && verMsg.FwString) {
    firmware = verMsg.FwString
  }
  if (/plane/i.test(firmware)) vehicle = 'ArduPlane'
  else if (/copter/i.test(firmware)) vehicle = 'ArduCopter'
  else if (/rover/i.test(firmware)) vehicle = 'Rover'
  else if (/sub/i.test(firmware)) vehicle = 'ArduSub'
  const frameMsg = msgs.find((m) => /^Frame[:\s]/i.test(m))
  const frame = frameMsg
    ? frameMsg.replace(/^Frame[:\s]+/i, '').trim()
    : vehicle === 'ArduPlane'
      ? 'Fixed-wing'
      : '—'
  if (!firmware) firmware = vehicle

  // --- Time base -----------------------------------------------------------
  // Backbone = ATT (always present, high rate). Restrict to the armed window
  // when ARM messages are available so idle bench time is excluded.
  const att = get('ATT')
  const backbone = series(att, 'Roll').length
    ? series(att, 'Roll')
    : series(get('GPS'), 'Spd')
  let t0 = backbone.length ? backbone[0][0] : 0
  let t1 = backbone.length ? backbone[backbone.length - 1][0] : 0
  const arm = get('ARM')
  if (arm && arm.length) {
    const armed = arm.find((r) => num(r.ArmState) === 1)
    const disarmed = [...arm].reverse().find((r) => num(r.ArmState) === 0)
    if (armed) t0 = Math.max(t0, num(armed.TimeUS))
    if (disarmed && num(disarmed.TimeUS) > t0) t1 = num(disarmed.TimeUS)
  }
  if (t1 <= t0) t1 = t0 + 1
  const durationSec = (t1 - t0) / 1e6

  const N = 480
  const times: number[] = []
  for (let i = 0; i < N; i++) times.push(t0 + ((t1 - t0) * i) / (N - 1))
  const tSec = times.map((u) => (u - t0) / 1e6)

  // --- Channel sources -----------------------------------------------------
  let altSrc = series(get('POS'), 'RelHomeAlt')
  if (!altSrc.length) altSrc = series(get('BARO'), 'Alt')
  if (!altSrc.length) altSrc = series(get('CTUN'), 'Alt') // Copter CTUN
  if (!altSrc.length) {
    const g = series(get('GPS'), 'Alt')
    if (g.length) {
      const base = g[0][1]
      altSrc = g.map(([t, v]) => [t, v - base] as [number, number])
    }
  }

  const gspdSrc = series(get('GPS'), 'Spd')
  const vbatSrc = series0(get('BAT'), 'Volt', 'Inst')
  const currSrc = series0(get('BAT'), 'Curr', 'Inst')
  let throttleSrc = series(get('CTUN'), 'ThO')
  // Copter logs ThO as a 0–1 fraction; Plane logs it as 0–100 percent.
  if (throttleSrc.length && max(throttleSrc) <= 1.5) {
    throttleSrc = throttleSrc.map(([t, v]) => [t, v * 100] as [number, number])
  }
  const vibeXSrc = series0(get('VIBE'), 'VibeX', 'IMU')
  const vibeYSrc = series0(get('VIBE'), 'VibeY', 'IMU')
  const vibeZSrc = series0(get('VIBE'), 'VibeZ', 'IMU')
  const rollSrc = series(att, 'Roll')
  const pitchSrc = series(att, 'Pitch')
  const yawSrc = series(att, 'Yaw')
  const satsSrc = series0(get('GPS'), 'NSats', 'I')
  const hdopSrc = series0(get('GPS'), 'HDop', 'I')
  const ekf = get('XKF4') ?? get('NKF4')
  const ekfSrc = series0(ekf, 'SV', 'C')

  const altR = resample(altSrc, times)
  const gspdR = resample(gspdSrc, times)
  const vbatR = resample(vbatSrc, times)
  const currR = resample(currSrc, times)
  const throttleR = resample(throttleSrc, times)
  const vibeXR = resample(vibeXSrc, times)
  const vibeYR = resample(vibeYSrc, times)
  const vibeZR = resample(vibeZSrc, times)
  const rollR = resample(rollSrc, times)
  const pitchR = resample(pitchSrc, times)
  const yawR = resample(yawSrc, times)
  const satsR = resample(satsSrc, times)
  const hdopR = resample(hdopSrc, times)
  const ekfR = resample(ekfSrc, times)

  const telemetry: TelemetrySample[] = []
  for (let i = 0; i < N; i++) {
    const dt = i === 0 ? 1 : tSec[i] - tSec[i - 1]
    const climb = i === 0 ? 0 : (altR[i] - altR[i - 1]) / (dt || 1)
    telemetry.push({
      t: r2(tSec[i]),
      alt: r2(altR[i]),
      climb: r2(climb),
      gspd: r2(gspdR[i]),
      vbat: r2(vbatR[i]),
      curr: r2(currR[i]),
      throttle: Math.round(throttleR[i]),
      vibeX: r2(vibeXR[i]),
      vibeY: r2(vibeYR[i]),
      vibeZ: r2(vibeZR[i]),
      roll: r2(rollR[i]),
      pitch: r2(pitchR[i]),
      yaw: Math.round((yawR[i] + 360) % 360),
      sats: Math.round(satsR[i]),
      hdop: r2(hdopR[i]),
      ekfVel: r2(ekfR[i]),
    })
  }

  // --- Summary stats (from raw series for fidelity) ------------------------
  const maxAltM = altSrc.length ? r2(max(altSrc)) : 0
  const maxSpeedMs = gspdSrc.length ? r2(max(gspdSrc)) : 0

  // --- Flight path + distance from POS lat/lng -----------------------------
  const pos = get('POS') ?? []
  const flightPath: [number, number, number][] = []
  let distanceM = 0
  const fixes = pos.filter(
    (r) => Number.isFinite(num(r.Lat)) && Number.isFinite(num(r.Lng)) && num(r.Lat) !== 0,
  )
  if (fixes.length > 1) {
    const lat0 = num(fixes[0].Lat)
    const lng0 = num(fixes[0].Lng)
    const mPerDegLat = 111320
    const mPerDegLng = 111320 * Math.cos((lat0 * Math.PI) / 180)
    let prevLat = lat0
    let prevLng = lng0
    const raw: [number, number, number][] = []
    for (const r of fixes) {
      const lat = num(r.Lat)
      const lng = num(r.Lng)
      const up = Number.isFinite(num(r.RelHomeAlt)) ? num(r.RelHomeAlt) : num(r.Alt)
      raw.push([(lng - lng0) * mPerDegLng, up, (lat - lat0) * mPerDegLat])
      distanceM += haversine(prevLat, prevLng, lat, lng)
      prevLat = lat
      prevLng = lng
    }
    // Downsample the track to keep the 3D panel light.
    const target = Math.min(raw.length, 260)
    for (let i = 0; i < target; i++) {
      const [x, y, z] = raw[Math.round((i * (raw.length - 1)) / (target - 1))]
      flightPath.push([r2(x), r2(y), r2(z)])
    }
  }

  // --- Battery -------------------------------------------------------------
  const startV = vbatSrc.length ? r2(vbatSrc[0][1]) : 0
  const endV = vbatSrc.length ? r2(vbatSrc[vbatSrc.length - 1][1]) : 0
  const minV = vbatSrc.length ? r2(min(vbatSrc)) : 0
  const maxCurrentA = currSrc.length ? r2(max(currSrc)) : 0
  const capUsedSrc = series0(get('BAT'), 'CurrTot', 'Inst')
  const capacityUsedmAh = capUsedSrc.length ? Math.round(max(capUsedSrc)) : 0
  const cells = startV > 0 ? Math.min(14, Math.max(1, Math.round(startV / 4.2))) : 0
  const capParam = (get('PARM') ?? []).find((r) => String(r.Name) === 'BATT_CAPACITY')
  const capacityFullmAh = capParam ? Math.round(num(capParam.Value)) : capacityUsedmAh

  // --- GPS / EKF -----------------------------------------------------------
  const FIX = ['No GPS', 'No Fix', '2D Fix', '3D Fix', 'DGPS', 'RTK Float', 'RTK Fixed']
  const statusSrc = series0(get('GPS'), 'Status', 'I')
  const fixType = statusSrc.length ? (FIX[Math.round(max(statusSrc))] ?? '3D Fix') : 'Unknown'
  const sats = satsSrc.length ? Math.round(satsSrc[satsSrc.length - 1][1]) : 0
  const hdop = hdopSrc.length ? r2(min(hdopSrc)) : 0
  const maxSV = ekfSrc.length ? max(ekfSrc) : 0
  const ekfStatus: Severity = maxSV >= 1.0 ? 'critical' : maxSV >= 0.8 ? 'warning' : 'good'
  const ekfNote = ekfSrc.length
    ? `EKF velocity variance peaked at ${r2(maxSV)}`
    : 'No EKF innovation data logged'

  // --- Vibration -----------------------------------------------------------
  const vx = vibeXSrc.length ? r2(max(vibeXSrc)) : 0
  const vy = vibeYSrc.length ? r2(max(vibeYSrc)) : 0
  const vz = vibeZSrc.length ? r2(max(vibeZSrc)) : 0
  const clipSrc = series0(get('VIBE'), 'Clip', 'IMU')
  const clipping = clipSrc.length ? Math.max(0, Math.round(max(clipSrc) - min(clipSrc))) : 0

  // --- Modes ---------------------------------------------------------------
  const modeTable =
    vehicle === 'ArduCopter' ? COPTER_MODES : vehicle === 'Rover' ? ROVER_MODES : PLANE_MODES
  // Drop mode changes logged after disarm; collapse any pre-arm modes to t=0
  // (keeping the one armed in) and dedupe consecutive repeats.
  const modes: ModeSegment[] = []
  for (const r of get('MODE') ?? []) {
    const n = Number.isFinite(num(r.ModeNum)) ? num(r.ModeNum) : num(r.Mode)
    const startSec = (num(r.TimeUS) - t0) / 1e6
    if (!Number.isFinite(startSec) || startSec > durationSec + 1) continue
    const name = modeTable[n] ?? `Mode ${n}`
    const start = r2(Math.max(0, startSec))
    const prev = modes[modes.length - 1]
    if (prev) {
      if (prev.name === name) continue
      if (prev.start === 0 && start === 0) {
        prev.name = name
        continue
      }
    }
    modes.push({ name, start })
  }

  // --- Findings ------------------------------------------------------------
  const problems: Problem[] = []
  const recommendations: Recommendation[] = []
  const vibeMax = Math.max(vx, vy, vz)
  if (vibeMax >= 30) {
    problems.push({
      severity: vibeMax >= 60 ? 'critical' : 'warning',
      title: 'High vibration levels',
      detail: `Peak vibration reached ${r2(vibeMax)} m/s² (warn threshold 30). Sustained high vibration corrupts the accel-derived altitude and can trigger EKF failsafes.`,
      source: 'VIBE.VibeX/Y/Z',
    })
    recommendations.push({
      title: 'Improve flight-controller vibration isolation',
      detail:
        'Add soft mounting and balance props/motors. Target vibration below 30 m/s² and zero clipping, then log raw IMU to design a harmonic notch filter.',
      params: ['INS_HNTCH_ENABLE', 'INS_HNTCH_FREQ', 'INS_HNTCH_BW', 'INS_LOG_BAT_MASK'],
    })
  }
  if (clipping > 0) {
    problems.push({
      severity: 'warning',
      title: `${clipping} accelerometer clipping event${clipping === 1 ? '' : 's'}`,
      detail:
        'Clipping means the accelerometer saturated — almost always a mounting / vibration problem that degrades state estimation.',
      source: 'VIBE.Clip',
    })
  }
  if (cells > 0 && minV / cells < 3.5) {
    problems.push({
      severity: minV / cells < 3.3 ? 'critical' : 'warning',
      title: 'Battery voltage sag under load',
      detail: `Pack dipped to ${minV} V (${r2(minV / cells)} V/cell) at up to ${maxCurrentA} A. Low per-cell voltage suggests an aging pack or under-rated C-rating.`,
      source: 'BAT.Volt / BAT.Curr',
    })
    recommendations.push({
      title: 'Inspect the battery / current path',
      detail:
        'Verify failsafe thresholds and consider a higher-capacity or higher-C pack. Reduce hover throttle if over-propped.',
      params: ['BATT_LOW_VOLT', 'BATT_CRT_VOLT', 'BATT_CAPACITY'],
    })
  }
  if (maxSV >= 0.8) {
    problems.push({
      severity: maxSV >= 1.0 ? 'critical' : 'warning',
      title: 'EKF velocity variance spike',
      detail: `EKF velocity variance reached ${r2(maxSV)}. Values approaching 1.0 indicate the filter is losing confidence — often correlated with vibration or GPS glitches.`,
      source: ekf === get('NKF4') ? 'NKF4.SV' : 'XKF4.SV',
    })
  }
  if (hdopSrc.length && (hdop > 1.5 || sats < 8)) {
    problems.push({
      severity: 'warning',
      title: 'Marginal GPS quality',
      detail: `Best HDOP ${hdop} with ${sats} satellites. Poor GPS geometry weakens position hold and RTL accuracy.`,
      source: 'GPS.HDop / GPS.NSats',
    })
  }
  if (problems.length === 0) {
    problems.push({
      severity: 'good',
      title: 'No major issues detected',
      detail:
        'Vibration, battery, GPS and EKF metrics are all within healthy margins for this flight.',
      source: 'VIBE / BAT / GPS / EKF',
    })
  }
  if (recommendations.length === 0) {
    recommendations.push({
      title: 'Log looks healthy',
      detail:
        'No corrective action stands out. Keep logging raw IMU periodically to track vibration trends as the airframe ages.',
      params: ['LOG_BITMASK', 'INS_LOG_BAT_MASK'],
    })
  }

  // --- loggedAt from GPS time ---------------------------------------------
  const gps0 = (get('GPS') ?? []).find(
    (r) => num(r.GWk) > 0 && Number.isFinite(num(r.GMS)),
  )
  const loggedAt = gps0 ? gpsToDate(num(gps0.GWk), num(gps0.GMS)) : '—'

  return {
    fileName,
    vehicle,
    frame,
    firmware: firmware || vehicle,
    loggedAt,
    durationSec: Math.round(durationSec),
    distanceM: Math.round(distanceM),
    maxAltM,
    maxSpeedMs,
    battery: {
      cells,
      startV,
      endV,
      minV,
      maxCurrentA,
      capacityUsedmAh,
      capacityFullmAh,
      voltageSeries: vbatSrc.length ? downsample(vbatR, 22) : [],
    },
    gps: { fixType, sats, hdop, ekfStatus, ekfNote },
    vibe: { x: vx, y: vy, z: vz, clipping, zSeries: vibeZSrc.length ? downsample(vibeZR, 22) : [] },
    altSeries: altSrc.length ? downsample(altR, 22) : [],
    flightPath,
    telemetry,
    modes,
    problems,
    recommendations,
  }
}
