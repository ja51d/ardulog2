import { useEffect, useRef } from 'react'

const COUNT = 16

/**
 * A glowing comet-style cursor trail.
 *
 * Performance / correctness notes:
 *  - All motion is driven by a single requestAnimationFrame loop that writes
 *    `transform` (translate3d) and `opacity` directly to the DOM nodes. We never
 *    call setState in the loop, so React never re-renders while the cursor moves.
 *  - Only hardware-accelerated properties (transform, opacity) are animated.
 *  - Every listener and the rAF handle are torn down on unmount.
 *  - Disabled for coarse pointers (touch) and when the user prefers reduced motion.
 */
export default function CursorTrail() {
  const dotsRef = useRef<Array<HTMLDivElement | null>>([])
  const pointer = useRef({ x: -100, y: -100 })
  const points = useRef(
    Array.from({ length: COUNT }, () => ({ x: -100, y: -100 })),
  )
  const rafRef = useRef(0)
  const active = useRef(false)
  const running = useRef(false)

  useEffect(() => {
    const finePointer = window.matchMedia('(pointer: fine)').matches
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    if (!finePointer || reducedMotion) return

    const render = () => {
      const pts = points.current
      // Lead point chases the cursor; each subsequent point chases the one
      // ahead of it, producing the trailing "comet" tail. Track the largest
      // per-frame movement so we know when the trail has caught up.
      let maxMove = 0
      const ldx = (pointer.current.x - pts[0].x) * 0.4
      const ldy = (pointer.current.y - pts[0].y) * 0.4
      pts[0].x += ldx
      pts[0].y += ldy
      maxMove = Math.max(maxMove, Math.abs(ldx), Math.abs(ldy))
      for (let i = 1; i < pts.length; i++) {
        const dx = (pts[i - 1].x - pts[i].x) * 0.4
        const dy = (pts[i - 1].y - pts[i].y) * 0.4
        pts[i].x += dx
        pts[i].y += dy
        maxMove = Math.max(maxMove, Math.abs(dx), Math.abs(dy))
      }

      for (let i = 0; i < pts.length; i++) {
        const node = dotsRef.current[i]
        if (!node) continue
        const scale = 1 - i / COUNT
        node.style.transform = `translate3d(${pts[i].x}px, ${pts[i].y}px, 0) translate(-50%, -50%) scale(${scale})`
        node.style.opacity = active.current ? `${0.55 * scale}` : '0'
      }

      // Keep animating only while the trail is still catching up (or fading
      // out). Once it settles on a stationary cursor we stop the loop entirely,
      // so an idle pointer costs zero frames.
      if (maxMove > 0.2) {
        rafRef.current = requestAnimationFrame(render)
      } else {
        running.current = false
      }
    }

    // (Re)start the loop on demand — a no-op if it's already running.
    const kick = () => {
      if (!running.current) {
        running.current = true
        rafRef.current = requestAnimationFrame(render)
      }
    }

    const onMove = (e: PointerEvent) => {
      pointer.current.x = e.clientX
      pointer.current.y = e.clientY
      if (!active.current) {
        // Snap the whole trail to the cursor on first appearance so it
        // doesn't streak in from the off-screen origin.
        active.current = true
        for (const p of points.current) {
          p.x = e.clientX
          p.y = e.clientY
        }
      }
      kick()
    }
    const onLeave = (e: PointerEvent) => {
      // pointerout bubbles for every element boundary; only fade the trail
      // when the pointer actually leaves the window (no relatedTarget).
      if (!e.relatedTarget) {
        active.current = false
        kick() // run a frame to write opacity 0, then auto-stop
      }
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerout', onLeave)

    return () => {
      cancelAnimationFrame(rafRef.current)
      running.current = false
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerout', onLeave)
    }
  }, [])

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[100] overflow-hidden"
      aria-hidden="true"
    >
      {Array.from({ length: COUNT }).map((_, i) => (
        <div
          key={i}
          ref={(el) => {
            dotsRef.current[i] = el
          }}
          className="absolute left-0 top-0 h-7 w-7 rounded-full opacity-0 will-change-[transform,opacity]"
          style={{
            background:
              'radial-gradient(circle, rgba(56,189,248,0.95) 0%, rgba(168,85,247,0.45) 55%, transparent 72%)',
            mixBlendMode: 'screen',
          }}
        />
      ))}
    </div>
  )
}
