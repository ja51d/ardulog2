import { useRef } from 'react'
import { gsap, useGSAP } from '../lib/gsap'

/**
 * Thin top bar whose width tracks the *absolute* scroll percentage of the
 * whole document (0% at the very top, 100% at the very bottom). Animates only
 * `scaleX`, which is GPU-composited.
 */
export default function ScrollProgress() {
  const barRef = useRef<HTMLDivElement>(null)

  useGSAP(() => {
    gsap.set(barRef.current, { scaleX: 0, transformOrigin: 'left center' })
    const tween = gsap.to(barRef.current, {
      scaleX: 1,
      ease: 'none',
      scrollTrigger: {
        trigger: document.documentElement,
        start: 'top top',
        end: 'bottom bottom',
        scrub: 0.3,
      },
    })
    // useGSAP reverts everything created here (incl. the ScrollTrigger) on unmount.
    return () => {
      tween.scrollTrigger?.kill()
    }
  })

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[90] h-0.5"
      aria-hidden
    >
      <div
        ref={barRef}
        className="h-full w-full origin-left bg-gradient-to-r from-sky-400 via-cyan-300 to-purple-500 will-change-transform"
      />
    </div>
  )
}
