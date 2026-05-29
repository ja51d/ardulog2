import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Grid, Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { LogAnalysis } from '../data/demoLog'
import { CardTitle } from './ui'

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Trajectory gradient: sky → cyan → violet, walked along the path by time.
const STOPS = ['#38bdf8', '#22d3ee', '#a855f7'].map((c) => new THREE.Color(c))
function colorAt(t: number) {
  const seg = Math.min(t, 0.999) * (STOPS.length - 1)
  const i = Math.floor(seg)
  return new THREE.Color().lerpColors(STOPS[i], STOPS[i + 1], seg - i)
}

/** A glowing marker that flies the reconstructed path on a loop. */
function Drone({ points }: { points: THREE.Vector3[] }) {
  const ref = useRef<THREE.Group>(null)
  const progress = useRef(0)
  const reduced = useMemo(reducedMotion, [])

  useFrame((_, delta) => {
    const g = ref.current
    if (!g || reduced) return
    progress.current = (progress.current + delta / 16) % 1
    const f = progress.current * (points.length - 1)
    const i = Math.floor(f)
    g.position.lerpVectors(points[i], points[Math.min(i + 1, points.length - 1)], f - i)
  })

  // Park at a visible mid-survey point when motion is suppressed.
  const parked = points[Math.floor(points.length * 0.45)]

  return (
    <group ref={ref} position={reduced ? parked : points[0]}>
      <mesh>
        <sphereGeometry args={[3, 20, 20]} />
        <meshStandardMaterial
          color="#e0f2fe"
          emissive="#38bdf8"
          emissiveIntensity={2.4}
          toneMapped={false}
        />
      </mesh>
      {/* Soft additive halo so the marker reads as a glowing point. */}
      <mesh>
        <sphereGeometry args={[6.5, 16, 16]} />
        <meshBasicMaterial
          color="#38bdf8"
          transparent
          opacity={0.18}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <pointLight color="#38bdf8" intensity={40} distance={120} decay={2} />
    </group>
  )
}

function Scene({ a }: { a: LogAnalysis }) {
  const reduced = useMemo(reducedMotion, [])

  const { points, colors, center, target } = useMemo(() => {
    const pts = a.flightPath.map(([x, y, z]) => new THREE.Vector3(x, y, z))
    const cols = pts.map((_, i) => colorAt(i / (pts.length - 1)))
    const box = new THREE.Box3().setFromPoints(pts)
    const c = box.getCenter(new THREE.Vector3())
    return { points: pts, colors: cols, center: c, target: c.toArray() }
  }, [a.flightPath])

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[60, 120, 40]} intensity={0.7} />

      {/* Wide soft pass behind a crisp pass → cheap neon-glow look. */}
      <Line points={points} vertexColors={colors} lineWidth={8} transparent opacity={0.14} />
      <Line points={points} vertexColors={colors} lineWidth={2.5} />

      {/* Launch / home pad. */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.15, 0]}>
        <ringGeometry args={[4.5, 6, 48]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.9} side={THREE.DoubleSide} />
      </mesh>

      <Drone points={points} />

      <Grid
        position={[center.x, 0, center.z]}
        args={[10, 10]}
        cellSize={20}
        cellThickness={0.6}
        cellColor="#27272a"
        sectionSize={100}
        sectionThickness={1}
        sectionColor="#3f3f46"
        fadeDistance={900}
        fadeStrength={1.4}
        infiniteGrid
      />

      <OrbitControls
        makeDefault
        target={target}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        autoRotate={!reduced}
        autoRotateSpeed={0.55}
        minDistance={90}
        maxDistance={900}
        minPolarAngle={0.15}
        maxPolarAngle={Math.PI / 2.05}
      />
    </>
  )
}

export default function FlightPath3D({ a }: { a: LogAnalysis }) {
  // Camera framing derived from the path's bounding box.
  const camera = useMemo(() => {
    const box = new THREE.Box3().setFromPoints(
      a.flightPath.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    )
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const d = Math.max(size.x, size.z, size.y) * 1.35
    return {
      position: [center.x + d * 0.65, center.y + d * 0.6, center.z + d * 0.85] as [
        number,
        number,
        number,
      ],
      fov: 50,
      near: 0.1,
      far: 6000,
    }
  }, [a.flightPath])

  // R3F's initial auto-measure can return 0 under React 19 StrictMode's
  // dev double-mount, leaving the canvas at its 300×150 default. One resize
  // event after paint forces a correct re-measure; harmless in production.
  useEffect(() => {
    const id = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
    return () => cancelAnimationFrame(id)
  }, [])

  // Only run the WebGL render loop while the canvas is on (or near) screen.
  // Scrolled fully away, frameloop="never" idles the GPU completely.
  const containerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: '120px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div className="flex h-full flex-col">
      <CardTitle
        title="3D Flight Path"
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

      <div
        ref={containerRef}
        className="relative h-[320px] w-full overflow-hidden rounded-2xl border border-white/[0.06] bg-zinc-950/60 sm:h-[380px] lg:h-[460px]"
      >
        <Canvas
          frameloop={visible ? 'always' : 'never'}
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: true }}
          camera={camera}
          resize={{ offsetSize: true }}
        >
          <Scene a={a} />
        </Canvas>

        {/* Legend — pinned over the canvas, non-interactive. */}
        <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-3 rounded-full border border-white/10 bg-zinc-950/70 px-3 py-1.5 text-[11px] text-zinc-400 backdrop-blur-sm">
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
    </div>
  )
}
