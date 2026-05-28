// Representative analysis of an ArduPilot DataFlash (.bin) log.
//
// NOTE: Real in-browser .bin parsing (FMT/FMTU message decoding of the
// DataFlash binary format) is a substantial piece of work and is intentionally
// stubbed for now — every uploaded file currently maps to this sample analysis
// so the UI can be built and reviewed end-to-end. The shape below mirrors the
// fields a real parser would emit.

export type Severity = 'critical' | 'warning' | 'info' | 'good'

export interface Problem {
  severity: Severity
  title: string
  detail: string
  /** ArduPilot log message / parameter the finding is derived from. */
  source: string
}

export interface Recommendation {
  title: string
  detail: string
  /** Concrete parameters to inspect or change. */
  params: string[]
}

export interface ModeSegment {
  /** Flight mode name as it appears in the MODE message. */
  name: string
  /** Seconds from arm at which the mode began. */
  start: number
}

export interface TelemetrySample {
  /** Seconds since arm. */
  t: number
  alt: number
  climb: number
  gspd: number
  vbat: number
  curr: number
  throttle: number
  vibeX: number
  vibeY: number
  vibeZ: number
  roll: number
  pitch: number
  yaw: number
  sats: number
  hdop: number
  ekfVel: number
}

/** A plottable telemetry channel and how to present it. */
export interface TelemetryChannel {
  key: Exclude<keyof TelemetrySample, 't'>
  label: string
  unit: string
  color: string
  group: string
}

export const TELEMETRY_CHANNELS: TelemetryChannel[] = [
  { key: 'alt', label: 'Altitude', unit: 'm', color: '#38bdf8', group: 'Position' },
  { key: 'climb', label: 'Climb rate', unit: 'm/s', color: '#7dd3fc', group: 'Position' },
  { key: 'gspd', label: 'Ground speed', unit: 'm/s', color: '#22d3ee', group: 'Position' },
  { key: 'vbat', label: 'Battery', unit: 'V', color: '#34d399', group: 'Power' },
  { key: 'curr', label: 'Current', unit: 'A', color: '#f59e0b', group: 'Power' },
  { key: 'throttle', label: 'Throttle', unit: '%', color: '#fbbf24', group: 'Power' },
  { key: 'vibeX', label: 'Vibe X', unit: 'm/s²', color: '#a3e635', group: 'Vibration' },
  { key: 'vibeY', label: 'Vibe Y', unit: 'm/s²', color: '#facc15', group: 'Vibration' },
  { key: 'vibeZ', label: 'Vibe Z', unit: 'm/s²', color: '#fb7185', group: 'Vibration' },
  { key: 'roll', label: 'Roll', unit: '°', color: '#c084fc', group: 'Attitude' },
  { key: 'pitch', label: 'Pitch', unit: '°', color: '#a855f7', group: 'Attitude' },
  { key: 'yaw', label: 'Yaw', unit: '°', color: '#818cf8', group: 'Attitude' },
  { key: 'sats', label: 'GPS sats', unit: '', color: '#2dd4bf', group: 'GPS / EKF' },
  { key: 'hdop', label: 'HDOP', unit: '', color: '#5eead4', group: 'GPS / EKF' },
  { key: 'ekfVel', label: 'EKF vel var', unit: '', color: '#f43f5e', group: 'GPS / EKF' },
]

export interface LogAnalysis {
  fileName: string
  vehicle: string
  frame: string
  firmware: string
  loggedAt: string
  durationSec: number
  distanceM: number
  maxAltM: number
  maxSpeedMs: number
  battery: {
    cells: number
    startV: number
    endV: number
    minV: number
    maxCurrentA: number
    capacityUsedmAh: number
    capacityFullmAh: number
    /** Per-sample pack voltage, evenly spaced across the flight. */
    voltageSeries: number[]
  }
  gps: {
    fixType: string
    sats: number
    hdop: number
    ekfStatus: Severity
    ekfNote: string
  }
  vibe: {
    x: number
    y: number
    z: number
    clipping: number
    zSeries: number[]
  }
  altSeries: number[]
  /**
   * Reconstructed 3D trajectory as `[east, up, north]` metre offsets from the
   * launch point — three.js axis convention (Y is up, ground is the XZ plane).
   */
  flightPath: [number, number, number][]
  /** Unified per-sample telemetry, evenly spaced from arm to disarm. */
  telemetry: TelemetrySample[]
  modes: ModeSegment[]
  problems: Problem[]
  recommendations: Recommendation[]
}

/**
 * Procedurally reconstruct a plausible survey sortie from the launch point:
 * vertical takeoff → transit/climb-out → lawnmower survey grid → RTL climb and
 * return → vertical land. Coordinates are `[east, up, north]` in metres, which
 * maps straight onto three.js world axes. Deterministic, so the rendered path
 * is stable across reloads. Total ground track ≈ the logged 1.84 km.
 */
function buildFlightPath(): [number, number, number][] {
  const path: [number, number, number][] = []
  const push = (x: number, y: number, z: number) =>
    path.push([
      Math.round(x * 100) / 100,
      Math.round(y * 100) / 100,
      Math.round(z * 100) / 100,
    ])
  // Smoothstep for natural ease in/out between waypoints.
  const ease = (t: number) => t * t * (3 - 2 * t)
  const last = () => path[path.length - 1]

  // Phase 1 — vertical takeoff with a gentle drift (Stabilize → AltHold).
  for (let i = 0; i <= 24; i++) {
    const t = i / 24
    push(Math.sin(t * Math.PI) * 4, t * 32, t * 6)
  }

  // Phase 2 — transit and climb out to the first survey corner (Loiter → Auto).
  const a = last()
  const surveyStart: [number, number, number] = [-118, 72, -88]
  for (let i = 1; i <= 36; i++) {
    const e = ease(i / 36)
    push(
      a[0] + (surveyStart[0] - a[0]) * e,
      a[1] + (surveyStart[1] - a[1]) * e,
      a[2] + (surveyStart[2] - a[2]) * e,
    )
  }

  // Phase 3 — lawnmower survey: long sweeps along X, stepping north in Z, with
  // a gentle terrain-following altitude undulation.
  const passes = 6
  const xMin = -118
  const xMax = 118
  const zFrom = -88
  const zTo = 64
  const alt = (x: number, p: number) => 72 + Math.sin(x / 38 + p) * 4 + p * 0.8
  for (let p = 0; p < passes; p++) {
    const z = zFrom + ((zTo - zFrom) * p) / (passes - 1)
    const [x0, x1] = p % 2 === 0 ? [xMin, xMax] : [xMax, xMin]
    for (let i = 1; i <= 28; i++) {
      const x = x0 + (x1 - x0) * (i / 28)
      push(x, alt(x, p), z)
    }
    if (p < passes - 1) {
      const zNext = zFrom + ((zTo - zFrom) * (p + 1)) / (passes - 1)
      for (let i = 1; i <= 8; i++) {
        push(x1, alt(x1, p), z + (zNext - z) * (i / 8))
      }
    }
  }

  // Phase 4 — RTL: brief climb to RTL altitude, then a straight run home while
  // bleeding off height.
  const r = last()
  for (let i = 1; i <= 44; i++) {
    const t = i / 44
    const e = ease(t)
    const climb = Math.sin(Math.min(t * 2, 1) * Math.PI) * 6
    push(r[0] + (0 - r[0]) * e, r[1] + (30 - r[1]) * e + climb, r[2] + (0 - r[2]) * e)
  }

  // Phase 5 — vertical descent and land back at the launch point.
  for (let i = 1; i <= 18; i++) {
    push(0, 30 * (1 - i / 18), 0)
  }

  return path
}

/**
 * Synthesize a unified per-sample telemetry stream consistent with the summary
 * stats and flight phases above: takeoff climb-out, lawnmower survey, RTL, land.
 * Deterministic (sine-based wiggle, no RNG) so the charts are stable across
 * reloads. The Z-vibration event and the EKF velocity-variance spike are both
 * centred on ~142 s, matching the correlated finding in `problems`.
 */
function buildTelemetry(): TelemetrySample[] {
  const N = 480
  const dur = 702
  const r2 = (n: number) => Math.round(n * 100) / 100

  // Linear interpolation of a coarse keyframe series at u ∈ [0, 1].
  const at = (s: number[], u: number) => {
    const f = Math.max(0, Math.min(1, u)) * (s.length - 1)
    const i = Math.floor(f)
    return s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * (f - i)
  }
  // Smooth deterministic wiggle in roughly [-1, 1].
  const wig = (t: number, k: number) =>
    Math.sin(t * k) * 0.6 + Math.sin(t * k * 2.3 + 1.7) * 0.4

  const altKf = [0, 6, 18, 34, 50, 62, 70, 75, 78, 77, 76, 78, 74, 70, 66, 58, 47, 36, 24, 14, 6, 0]
  const vbatKf = [
    25.1, 24.9, 24.6, 24.3, 24.1, 23.9, 23.8, 23.6, 23.5, 23.3, 23.2, 23.0, 22.9,
    22.7, 22.6, 22.4, 22.3, 21.9, 21.6, 22.0, 22.2, 22.3,
  ]

  const dt = dur / (N - 1)
  const rows: TelemetrySample[] = []
  let prevAlt = 0
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1)
    const t = u * dur

    const alt = Math.max(0, at(altKf, u) + wig(t, 0.08) * 0.6)
    const climb = i === 0 ? 0 : (alt - prevAlt) / dt
    prevAlt = alt

    const transit = t >= 95 && t < 150
    const survey = t >= 150 && t <= 640
    const rtl = t > 640 && t < 690
    const airborne = t > 8 && t < 695

    let gspd = 0
    if (transit) gspd = 11 + wig(t, 0.2)
    else if (survey) gspd = 9.5 + 3.4 * Math.abs(Math.sin(t * 0.06)) + wig(t, 0.5)
    else if (rtl) gspd = 12 + wig(t, 0.2)
    else if (airborne) gspd = 1.5 + Math.abs(wig(t, 0.3))
    gspd = Math.max(0, Math.min(14.2, gspd))

    const hover = 47
    let throttle = hover + climb * 5.5 + (survey ? 2 : 0) + wig(t, 0.15) * 2
    if (t <= 8) throttle = (t / 8) * 70 + 10
    throttle = Math.max(0, Math.min(100, throttle))

    const curr = Math.max(0, throttle * 0.62 + 3.5 + wig(t, 0.25) * 1.5)
    const vbat = at(vbatKf, u) + wig(t, 0.4) * 0.03

    // Vibration baseline rises in flight; Z carries the 33 m/s² event at ~142 s.
    const vbase = airborne ? 8 : 2
    const zEvent = 20 * Math.exp(-((t - 142) ** 2) / (2 * 34 * 34))
    const vibeX = Math.max(0, vbase + 3 + Math.abs(wig(t, 0.6)) * 4)
    const vibeY = Math.max(0, vbase + 4.5 + Math.abs(wig(t, 0.55)) * 4.5)
    const vibeZ = Math.max(0, vbase + 3 + zEvent + Math.abs(wig(t, 0.7)) * 2.5)

    const roll = airborne ? 7 * Math.sin(t * 0.22) + wig(t, 0.5) * 3 : 0
    const pitch = airborne
      ? (survey || transit ? -6 : 0) + 5 * Math.sin(t * 0.18) + wig(t, 0.4) * 2
      : 0
    // Yaw flips ~180° each survey pass; points outbound otherwise.
    const yawBase = survey ? (Math.sin(t * 0.045) > 0 ? 90 : 270) : transit ? 225 : 0
    const yaw = (yawBase + wig(t, 0.3) * 6 + 360) % 360

    const sats = Math.round(18 + wig(t, 0.12) * 1.2)
    const hdop = Math.max(0.5, 0.72 - (sats - 18) * 0.04 + wig(t, 0.2) * 0.05)
    // EKF velocity-variance spike at 142 s, correlated with the vibration event.
    const ekfVel = Math.max(
      0.05,
      0.16 + 0.78 * Math.exp(-((t - 142) ** 2) / (2 * 9 * 9)) + Math.abs(wig(t, 0.5)) * 0.06,
    )

    rows.push({
      t: r2(t),
      alt: r2(alt),
      climb: r2(climb),
      gspd: r2(gspd),
      vbat: r2(vbat),
      curr: r2(curr),
      throttle: Math.round(throttle),
      vibeX: r2(vibeX),
      vibeY: r2(vibeY),
      vibeZ: r2(vibeZ),
      roll: r2(roll),
      pitch: r2(pitch),
      yaw: Math.round(yaw),
      sats,
      hdop: r2(hdop),
      ekfVel: r2(ekfVel),
    })
  }
  return rows
}

export const DEMO_ANALYSIS: LogAnalysis = {
  fileName: 'sample_flight.bin',
  vehicle: 'ArduCopter',
  frame: 'Quad / X',
  firmware: 'ArduCopter 4.5.7 (stable)',
  loggedAt: '2026-05-21 14:32 UTC',
  durationSec: 702,
  distanceM: 1840,
  maxAltM: 78.4,
  maxSpeedMs: 14.2,
  battery: {
    cells: 6,
    startV: 25.1,
    endV: 22.3,
    minV: 21.6,
    maxCurrentA: 62.4,
    capacityUsedmAh: 7850,
    capacityFullmAh: 10000,
    voltageSeries: [
      25.1, 24.9, 24.6, 24.3, 24.1, 23.9, 23.8, 23.6, 23.5, 23.3, 23.2, 23.0,
      22.9, 22.7, 22.6, 22.4, 22.3, 21.9, 21.6, 22.0, 22.2, 22.3,
    ],
  },
  gps: {
    fixType: '3D Fix',
    sats: 18,
    hdop: 0.7,
    ekfStatus: 'warning',
    ekfNote: 'Velocity variance spike (0.92) at 142 s',
  },
  vibe: {
    x: 12.3,
    y: 14.1,
    z: 33.6,
    clipping: 2,
    zSeries: [
      8, 10, 12, 14, 18, 22, 19, 24, 28, 31, 27, 33, 36, 30, 34, 38, 29, 26,
      22, 18, 15, 12,
    ],
  },
  altSeries: [
    0, 6, 18, 34, 50, 62, 70, 75, 78, 77, 76, 78, 74, 70, 66, 58, 47, 36, 24,
    14, 6, 0,
  ],
  flightPath: buildFlightPath(),
  telemetry: buildTelemetry(),
  modes: [
    { name: 'Stabilize', start: 0 },
    { name: 'AltHold', start: 28 },
    { name: 'Loiter', start: 95 },
    { name: 'Auto', start: 150 },
    { name: 'RTL', start: 640 },
    { name: 'Land', start: 688 },
  ],
  problems: [
    {
      severity: 'critical',
      title: 'High Z-axis vibration',
      detail:
        'VibeZ peaked at 33.6 m/s² (warn threshold 30). Sustained high vibration corrupts the accel-derived altitude and can trigger EKF failsafes.',
      source: 'VIBE.VibeZ',
    },
    {
      severity: 'warning',
      title: '2 accelerometer clipping events',
      detail:
        'IMU0 reported 2 clipping events. Clipping means the accelerometer saturated — almost always a mounting / vibration problem.',
      source: 'VIBE.Clip0',
    },
    {
      severity: 'warning',
      title: 'Battery voltage sag under load',
      detail:
        'Pack dipped to 21.6 V (3.60 V/cell) during high-current climb at 62.4 A. Resting voltage recovered, indicating internal resistance / pack age.',
      source: 'BAT.Volt / BAT.Curr',
    },
    {
      severity: 'warning',
      title: 'EKF velocity variance spike',
      detail:
        'EKF3 velocity variance reached 0.92 at 142 s, correlated with the vibration peak. No failsafe fired, but margins were thin.',
      source: 'XKF4.SV',
    },
    {
      severity: 'info',
      title: 'Compass vs GPS heading drift',
      detail:
        'Up to 9° disagreement between compass yaw and GPS course over ground during fast forward flight. Likely motor-current interference.',
      source: 'MAG / GPS.GCrs',
    },
  ],
  recommendations: [
    {
      title: 'Improve flight-controller vibration isolation',
      detail:
        'Add soft mounting (gel/o-ring) and balance props. Target VibeX/Y/Z below 30 m/s² and zero clipping. Log raw IMU to design a notch filter.',
      params: ['INS_LOG_BAT_MASK', 'INS_LOG_BAT_OPT', 'LOG_BITMASK'],
    },
    {
      title: 'Configure the harmonic notch filter',
      detail:
        'Use the post-flight FFT to set a notch at the motor fundamental. This removes vibration noise feeding the rate controllers and EKF.',
      params: ['INS_HNTCH_ENABLE', 'INS_HNTCH_FREQ', 'INS_HNTCH_BW', 'INS_HNTCH_MODE'],
    },
    {
      title: 'Inspect the battery / current path',
      detail:
        'Sag to 3.60 V/cell suggests an aging pack or under-rated C. Verify failsafe thresholds and reduce hover throttle if over-propped.',
      params: ['BATT_LOW_VOLT', 'BATT_CRT_VOLT', 'MOT_THST_HOVER', 'MOT_BAT_VOLT_MAX'],
    },
    {
      title: 'Re-calibrate and prioritise compasses',
      detail:
        'Run compass calibration away from power leads, enable compass learning, and route the battery harness away from the magnetometer.',
      params: ['COMPASS_LEARN', 'COMPASS_USE2', 'COMPASS_PRIO1_ID', 'COMPASS_OFFS_MAX'],
    },
  ],
}
