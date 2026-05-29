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
  FftAnalysis,
  FftTrace,
  LogAnalysis,
  ModeSegment,
  PidAnalysis,
  PidAxisTrace,
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

// ---------------------------------------------------------------------------
// PID rate-controller tracking. ArduPilot logs each rate loop as PIDR/PIDP/PIDY
// with a demanded `Tar` and achieved `Act`. We resample both onto a common grid
// and score how tightly actual follows target. When no PID messages exist
// (older Plane logs, light bitmasks) we fall back to ATT attitude tracking.
// ---------------------------------------------------------------------------

function pidAxisFrom(
  rows: Row[] | undefined,
  axis: PidAxisTrace['axis'],
  tarKey: string,
  actKey: string,
  t0: number,
  t1: number,
  gains: { p: number; i: number; d: number } | null,
): PidAxisTrace | null {
  const tar = series(rows, tarKey)
  const act = series(rows, actKey)
  if (tar.length < 4 || act.length < 4) return null
  const M = 240
  const times: number[] = []
  for (let i = 0; i < M; i++) times.push(t0 + ((t1 - t0) * i) / (M - 1))
  const tarR = resample(tar, times)
  const actR = resample(act, times)
  const t: number[] = []
  const target: number[] = []
  const actual: number[] = []
  let sumSq = 0
  let maxErr = 0
  let maxAbsTar = 0
  for (let i = 0; i < M; i++) {
    const e = tarR[i] - actR[i]
    sumSq += e * e
    if (Math.abs(e) > maxErr) maxErr = Math.abs(e)
    if (Math.abs(tarR[i]) > maxAbsTar) maxAbsTar = Math.abs(tarR[i])
    t.push(r2((times[i] - t0) / 1e6))
    target.push(r2(tarR[i]))
    actual.push(r2(actR[i]))
  }
  const rms = Math.sqrt(sumSq / M)
  const trackPct =
    maxAbsTar > 1 ? Math.max(0, Math.min(100, Math.round(100 - (100 * rms) / maxAbsTar))) : 100
  return { axis, t, target, actual, rmsError: r2(rms), maxError: r2(maxErr), trackPct, gains }
}

function buildPidAnalysis(
  get: (t: string) => Row[] | undefined,
  t0: number,
  t1: number,
): PidAnalysis {
  const parm = get('PARM') ?? []
  const param = (name: string): number => {
    const r = parm.find((p) => String(p.Name) === name)
    return r ? num(r.Value) : NaN
  }
  const round = (n: number, dp: number) => {
    const f = 10 ** dp
    return Math.round(n * f) / f
  }
  const gainsFor = (p: string, i: string, d: string) => {
    const P = param(p)
    if (!Number.isFinite(P)) return null
    const I = param(i)
    const D = param(d)
    return { p: round(P, 4), i: round(Number.isFinite(I) ? I : 0, 4), d: round(Number.isFinite(D) ? D : 0, 5) }
  }

  // Preferred: dedicated rate-controller PID messages (Tar = demand, Act = achieved).
  const rateAxes = [
    pidAxisFrom(get('PIDR'), 'Roll', 'Tar', 'Act', t0, t1, gainsFor('ATC_RAT_RLL_P', 'ATC_RAT_RLL_I', 'ATC_RAT_RLL_D')),
    pidAxisFrom(get('PIDP'), 'Pitch', 'Tar', 'Act', t0, t1, gainsFor('ATC_RAT_PIT_P', 'ATC_RAT_PIT_I', 'ATC_RAT_PIT_D')),
    pidAxisFrom(get('PIDY'), 'Yaw', 'Tar', 'Act', t0, t1, gainsFor('ATC_RAT_YAW_P', 'ATC_RAT_YAW_I', 'ATC_RAT_YAW_D')),
  ].filter((a): a is PidAxisTrace => a !== null)
  if (rateAxes.length) {
    return {
      unit: 'deg/s',
      source: 'PIDR / PIDP / PIDY',
      axes: rateAxes,
      note: 'Rate-controller demand vs achieved. Tight tracking with small, fast-settling error means the P/D gains suit the airframe.',
    }
  }

  // Fallback: attitude tracking from ATT (DesRoll vs Roll …), in degrees.
  const att = get('ATT')
  const attAxes = [
    pidAxisFrom(att, 'Roll', 'DesRoll', 'Roll', t0, t1, gainsFor('ATC_ANG_RLL_P', 'ATC_RAT_RLL_I', 'ATC_RAT_RLL_D')),
    pidAxisFrom(att, 'Pitch', 'DesPitch', 'Pitch', t0, t1, gainsFor('ATC_ANG_PIT_P', 'ATC_RAT_PIT_I', 'ATC_RAT_PIT_D')),
    pidAxisFrom(att, 'Yaw', 'DesYaw', 'Yaw', t0, t1, gainsFor('ATC_ANG_YAW_P', 'ATC_RAT_YAW_I', 'ATC_RAT_YAW_D')),
  ].filter((a): a is PidAxisTrace => a !== null)
  if (attAxes.length) {
    return {
      unit: '°',
      source: 'ATT (attitude)',
      axes: attAxes,
      note: 'No rate-loop PID logging found, so this shows demanded vs achieved attitude angles. Enable PID logging (LOG_BITMASK) for true rate-loop tuning.',
    }
  }
  return { unit: 'deg/s', source: '—', axes: [], note: 'No PID or attitude tracking data was logged.' }
}

// ---------------------------------------------------------------------------
// FFT — gyro noise spectrum for harmonic-notch tuning. Iterative radix-2.
// ---------------------------------------------------------------------------

/** In-place iterative radix-2 Cooley–Tukey FFT (length must be a power of 2). */
function fftRadix2(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr
      const ti = im[i]; im[i] = im[j]; im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    const half = len >> 1
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < half; k++) {
        const a = i + k
        const b = a + half
        const vr = re[b] * cr - im[b] * ci
        const vi = re[b] * ci + im[b] * cr
        re[b] = re[a] - vr
        im[b] = im[a] - vi
        re[a] += vr
        im[a] += vi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

/** Magnitude spectrum (0..N/2) of a real signal with mean removed + Hann window. */
function magnitudeSpectrum(vals: number[]): number[] {
  const N = vals.length
  let mean = 0
  for (const v of vals) mean += v
  mean /= N
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)) // Hann
    re[i] = (vals[i] - mean) * w
  }
  fftRadix2(re, im)
  const half = N >> 1
  const mag = new Array<number>(half + 1)
  for (let k = 0; k <= half; k++) mag[k] = Math.hypot(re[k], im[k])
  return mag
}

function emptyFft(note: string): FftAnalysis {
  return { source: '—', sampleRateHz: 0, reliable: false, freqs: [], axes: [], dominantHz: 0, note }
}

function buildFftAnalysis(get: (t: string) => Row[] | undefined): FftAnalysis {
  const imu = get('IMU')
  if (!imu || imu.length < 256) {
    return emptyFft('No raw IMU gyro data was logged — enable IMU logging for an FFT.')
  }
  // Prefer the primary IMU; collect time-aligned gyro samples.
  let rows = imu.filter((r) => num(r.I) === 0)
  if (rows.length < 256) rows = imu
  const ts: number[] = []
  const gx: number[] = []
  const gy: number[] = []
  const gz: number[] = []
  for (const r of rows) {
    const t = num(r.TimeUS)
    const x = num(r.GyrX)
    const y = num(r.GyrY)
    const z = num(r.GyrZ)
    if ([t, x, y, z].every(Number.isFinite)) {
      ts.push(t)
      gx.push(x)
      gy.push(y)
      gz.push(z)
    }
  }
  const total = ts.length
  if (total < 256) return emptyFft('Not enough contiguous IMU gyro samples for an FFT.')

  // Sample rate from the median Δt around the middle of the flight.
  const mid = Math.floor(total / 2)
  const dts: number[] = []
  for (let i = Math.max(1, mid - 256); i < Math.min(total, mid + 256); i++) dts.push(ts[i] - ts[i - 1])
  dts.sort((a, b) => a - b)
  const medDt = dts[Math.floor(dts.length / 2)] || 0
  const fs = medDt > 0 ? 1e6 / medDt : 0
  if (fs < 18) return emptyFft('IMU log rate is too low for a meaningful spectrum.')

  // Largest power-of-2 window ≤ min(samples, 4096), centred on the cruise.
  let N = 1
  while (N * 2 <= Math.min(total, 4096)) N *= 2
  const start = Math.max(0, Math.min(total - N, mid - (N >> 1)))
  const slice = (arr: number[]) => arr.slice(start, start + N)

  const specs = [
    { axis: 'GyrX', mag: magnitudeSpectrum(slice(gx)) },
    { axis: 'GyrY', mag: magnitudeSpectrum(slice(gy)) },
    { axis: 'GyrZ', mag: magnitudeSpectrum(slice(gz)) },
  ]
  const half = N >> 1
  const binHz = fs / N
  const nyquist = fs / 2
  const reliable = nyquist >= 60 // enough headroom to resolve the motor/prop band
  // When we can reach the motor band, ignore < 8 Hz (DC / airframe sway) so the
  // peak lands on the motors. On low-rate logs that band is all we have, so we
  // only strip the very lowest bins (drift) and keep everything else.
  const lowCutHz = reliable ? 8 : 1.5
  const kLow = Math.max(1, Math.ceil(lowCutHz / binHz))
  const gMax = Math.max(...specs.flatMap((s) => s.mag.slice(kLow))) || 1

  // Downsample the half-spectrum to a fixed number of plot bins (up to Nyquist).
  const PLOT = 150
  const idxs: number[] = []
  const freqs: number[] = []
  for (let i = 0; i < PLOT; i++) {
    const k = Math.round((i * half) / (PLOT - 1))
    idxs.push(k)
    freqs.push(Math.round(k * binHz * 10) / 10)
  }

  let dominantHz = 0
  let dominantMag = 0
  const axes: FftTrace[] = specs.map((s) => {
    let peakK = kLow
    for (let k = kLow; k <= half; k++) if (s.mag[k] > s.mag[peakK]) peakK = k
    const peakHz = Math.round(peakK * binHz * 10) / 10
    if (s.mag[peakK] > dominantMag) {
      dominantMag = s.mag[peakK]
      dominantHz = peakHz
    }
    return {
      axis: s.axis,
      peakHz,
      mag: idxs.map((k) => Math.round((s.mag[k] / gMax) * 1000) / 1000),
    }
  })

  return {
    source: 'IMU.Gyr',
    sampleRateHz: Math.round(fs),
    reliable,
    freqs,
    axes,
    dominantHz,
    note: reliable
      ? `Gyro noise spectrum over ${N} samples at ~${Math.round(fs)} Hz. The dominant peak is the harmonic-notch candidate (INS_HNTCH_FREQ).`
      : `IMU was logged at only ~${Math.round(fs)} Hz (Nyquist ${Math.round(nyquist)} Hz), so this shows low-frequency content only — not the motor band. Enable batch sampling (INS_LOG_BAT_MASK) for a full vibration FFT.`,
  }
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
  const geoPath: [number, number, number][] = []
  let home: { lat: number; lng: number } | null = null
  let distanceM = 0
  const fixes = pos.filter(
    (r) => Number.isFinite(num(r.Lat)) && Number.isFinite(num(r.Lng)) && num(r.Lat) !== 0,
  )
  if (fixes.length > 1) {
    const lat0 = num(fixes[0].Lat)
    const lng0 = num(fixes[0].Lng)
    home = { lat: Math.round(lat0 * 1e6) / 1e6, lng: Math.round(lng0 * 1e6) / 1e6 }
    const mPerDegLat = 111320
    const mPerDegLng = 111320 * Math.cos((lat0 * Math.PI) / 180)
    let prevLat = lat0
    let prevLng = lng0
    const raw: [number, number, number][] = []
    const rawGeo: [number, number, number][] = []
    for (const r of fixes) {
      const lat = num(r.Lat)
      const lng = num(r.Lng)
      const up = Number.isFinite(num(r.RelHomeAlt)) ? num(r.RelHomeAlt) : num(r.Alt)
      raw.push([(lng - lng0) * mPerDegLng, up, (lat - lat0) * mPerDegLat])
      rawGeo.push([lng, lat, up])
      distanceM += haversine(prevLat, prevLng, lat, lng)
      prevLat = lat
      prevLng = lng
    }
    // Downsample the track to keep the map + payload light.
    const target = Math.min(raw.length, 260)
    for (let i = 0; i < target; i++) {
      const idx = Math.round((i * (raw.length - 1)) / (target - 1))
      const [x, y, z] = raw[idx]
      flightPath.push([r2(x), r2(y), r2(z)])
      const [glng, glat, gup] = rawGeo[idx]
      geoPath.push([Math.round(glng * 1e6) / 1e6, Math.round(glat * 1e6) / 1e6, r2(gup)])
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

  // --- Power / efficiency --------------------------------------------------
  // Instantaneous electrical power = pack volts × current. Integrate over the
  // (evenly spaced) sample grid for energy; pair with distance for efficiency.
  const havePower = vbatSrc.length > 0 && currSrc.length > 0
  let whUsed = 0
  let peakW = 0
  if (havePower) {
    const dtSec = durationSec / (N - 1)
    for (let i = 0; i < N; i++) {
      const w = vbatR[i] * currR[i]
      if (w > peakW) peakW = w
      whUsed += w * dtSec
    }
    whUsed /= 3600
  }
  const avgW = havePower && durationSec > 0 ? (whUsed * 3600) / durationSec : 0
  const km = distanceM / 1000
  const mahPerKm =
    capacityUsedmAh > 0 && km > 0.01 ? Math.round(capacityUsedmAh / km) : 0
  const power = {
    whUsed: r2(whUsed),
    avgW: Math.round(avgW),
    peakW: Math.round(peakW),
    mahPerKm,
  }

  // --- Motor / servo outputs (RCOU) ----------------------------------------
  // RCOU logs each output channel (C1..Cn) as a PWM in microseconds. A channel
  // is "active" if it climbs above the disarmed idle and actually moves; unused
  // outputs sit pinned at a constant and are filtered out.
  const isMultirotor = vehicle === 'ArduCopter'
  const rcou = get('RCOU') ?? []
  const outChannels: { label: string; min: number; avg: number; max: number }[] = []
  if (rcou.length) {
    for (let ch = 1; ch <= 16; ch++) {
      const key = `C${ch}`
      let lo = Infinity
      let hi = -Infinity
      let sum = 0
      let cnt = 0
      for (const r of rcou) {
        const v = num(r[key])
        if (!Number.isFinite(v)) continue
        if (v < lo) lo = v
        if (v > hi) hi = v
        sum += v
        cnt++
      }
      if (cnt > 0 && hi >= 1000 && hi - lo >= 8) {
        outChannels.push({
          label: isMultirotor ? `M${ch}` : `C${ch}`,
          min: Math.round(lo),
          avg: Math.round(sum / cnt),
          max: Math.round(hi),
        })
      }
    }
  }
  let imbalancePct = 0
  let outNote = 'No RCOU output data logged.'
  if (isMultirotor && outChannels.length >= 2) {
    const avgs = outChannels.map((c) => c.avg)
    const maxAvg = Math.max(...avgs)
    const minAvg = Math.min(...avgs)
    const meanAvg = avgs.reduce((s, v) => s + v, 0) / avgs.length
    imbalancePct = meanAvg > 0 ? Math.round(((maxAvg - minAvg) / meanAvg) * 100) : 0
    const hottest = outChannels.find((c) => c.avg === maxAvg)
    outNote =
      imbalancePct >= 6
        ? `${hottest?.label ?? 'One motor'} runs ~${imbalancePct}% higher than the lowest — check CG, props and motor health.`
        : `Motor outputs are well balanced (~${imbalancePct}% spread).`
  } else if (outChannels.length) {
    outNote = 'Per-channel servo / throttle output ranges.'
  }
  const outputs = { channels: outChannels, imbalancePct, note: outNote }

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
  if (isMultirotor && imbalancePct >= 8) {
    problems.push({
      severity: imbalancePct >= 15 ? 'critical' : 'warning',
      title: 'Motor output imbalance',
      detail: `${outNote} A persistent imbalance points to a CG offset, a weak motor/ESC, or a bent prop or arm.`,
      source: 'RCOU.C1..Cn',
    })
    recommendations.push({
      title: 'Balance the airframe and drivetrain',
      detail:
        'Check centre of gravity, verify all props are matched and undamaged, and compare motor/ESC temperatures after a flight to find a weak link.',
      params: ['MOT_THST_HOVER', 'ATC_RAT_RLL_P', 'ATC_RAT_PIT_P'],
    })
  }
  // --- PID tracking + gyro FFT (computed here so findings can use them) ----
  const pid = buildPidAnalysis(get, t0, t1)
  const fft = buildFftAnalysis(get)
  const worstAxis = pid.axes.reduce<PidAxisTrace | null>(
    (w, a) => (w === null || a.trackPct < w.trackPct ? a : w),
    null,
  )
  if (worstAxis && worstAxis.trackPct < 80) {
    const tag = worstAxis.axis === 'Roll' ? 'RLL' : worstAxis.axis === 'Pitch' ? 'PIT' : 'YAW'
    problems.push({
      severity: worstAxis.trackPct < 60 ? 'critical' : 'warning',
      title: `${worstAxis.axis} rate tracking is loose`,
      detail: `${worstAxis.axis} actual lags demand with an RMS error of ${worstAxis.rmsError} ${pid.unit} (tracking ${worstAxis.trackPct}%). Soft tracking usually means the rate P/D gains are too low or vibration is corrupting the loop.`,
      source: pid.source,
    })
    recommendations.push({
      title: 'Tune the rate-controller gains',
      detail:
        'Raise rate P until the actual just starts to overshoot, then back off ~10% and add D to damp it. Run Autotune once vibration and the harmonic notch are sorted.',
      params: [`ATC_RAT_${tag}_P`, `ATC_RAT_${tag}_D`, 'AUTOTUNE_AXES'],
    })
  }
  if (fft.reliable && fft.dominantHz > 0) {
    recommendations.push({
      title: 'Set the harmonic notch from the FFT',
      detail: `The gyro spectrum peaks near ${fft.dominantHz} Hz. Centre the notch there and enable RPM/throttle tracking so it follows the motors across the throttle range.`,
      params: ['INS_HNTCH_ENABLE', 'INS_HNTCH_FREQ', 'INS_HNTCH_BW', 'INS_HNTCH_MODE'],
    })
  } else if (fft.axes.length && !fft.reliable) {
    recommendations.push({
      title: 'Raise IMU logging rate for a vibration FFT',
      detail: `IMU was logged at only ~${fft.sampleRateHz} Hz, so the spectrum can't reach the motor band. Enable batch sampling to capture raw high-rate gyro for a proper harmonic-notch FFT.`,
      params: ['INS_LOG_BAT_MASK', 'INS_LOG_BAT_OPT', 'INS_LOG_BAT_CNT', 'LOG_BITMASK'],
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
    power,
    outputs,
    altSeries: altSrc.length ? downsample(altR, 22) : [],
    flightPath,
    home,
    geoPath,
    telemetry,
    pid,
    fft,
    modes,
    problems,
    recommendations,
  }
}
