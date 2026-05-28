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
  modes: ModeSegment[]
  problems: Problem[]
  recommendations: Recommendation[]
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
