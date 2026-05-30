// Shared flight-mode → Tailwind background class, so the timeline, the modes
// card and anything else colour a given mode identically. Covers the common
// ArduCopter / ArduPlane / Rover modes; unknown modes get a stable colour
// hashed from the name. Every class below is a literal string so Tailwind's
// scanner keeps it in the build.

export const MODE_COLORS: Record<string, string> = {
  // Copter
  Stabilize: 'bg-zinc-500',
  AltHold: 'bg-sky-500',
  Loiter: 'bg-cyan-500',
  Auto: 'bg-violet-500',
  RTL: 'bg-amber-500',
  Land: 'bg-emerald-500',
  Guided: 'bg-indigo-500',
  PosHold: 'bg-teal-500',
  Acro: 'bg-rose-500',
  Brake: 'bg-orange-500',
  Circle: 'bg-fuchsia-500',
  Drift: 'bg-lime-500',
  Sport: 'bg-pink-500',
  Throw: 'bg-yellow-500',
  FlowHold: 'bg-blue-500',
  Follow: 'bg-purple-500',
  ZigZag: 'bg-green-500',
  AutoTune: 'bg-violet-400',
  SmartRTL: 'bg-amber-400',
  Smart_RTL: 'bg-amber-400',
  // Plane / QuadPlane
  Manual: 'bg-zinc-400',
  FBWA: 'bg-sky-400',
  FBWB: 'bg-cyan-400',
  Cruise: 'bg-teal-400',
  TakeOff: 'bg-emerald-400',
  Takeoff: 'bg-emerald-400',
  QLoiter: 'bg-cyan-600',
  QHover: 'bg-sky-600',
  QRTL: 'bg-amber-600',
}

const FALLBACK = [
  'bg-slate-500',
  'bg-red-500',
  'bg-blue-500',
  'bg-green-500',
  'bg-purple-500',
  'bg-orange-500',
  'bg-teal-600',
]

/** Tailwind `bg-*` class for a mode name; a stable colour for unknown modes. */
export function modeColorClass(name: string): string {
  const known = MODE_COLORS[name]
  if (known) return known
  let h = 0
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) >>> 0
  return FALLBACK[h % FALLBACK.length]
}
