import { useRef } from 'react'
import { gsap, useGSAP } from '../lib/gsap'

/**
 * Hero header. The wordmark scales up (and gently fades) in proportion to how
 * far the hero has been scrolled — i.e. driven by scroll percentage, scrubbed.
 * Only `scale` / `opacity` are animated, both GPU-friendly.
 */
export default function Header() {
  const root = useRef<HTMLElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)

  useGSAP(
    () => {
      gsap.to(titleRef.current, {
        scale: 1.55,
        opacity: 0.15,
        ease: 'none',
        scrollTrigger: {
          trigger: root.current,
          start: 'top top',
          end: 'bottom top',
          scrub: 0.5,
        },
      })
    },
    { scope: root },
  )

  return (
    <header
      ref={root}
      className="relative flex min-h-[88vh] flex-col items-center justify-center px-6 text-center"
    >
      <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium tracking-wide text-zinc-300 backdrop-blur">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
        ArduPilot UAV Log Viewer
      </span>

      <h1
        ref={titleRef}
        className="origin-center will-change-transform text-balance text-6xl font-semibold tracking-tight text-zinc-50 sm:text-7xl md:text-8xl"
      >
        Ardu
        <span className="bg-gradient-to-r from-sky-400 via-cyan-300 to-purple-400 bg-clip-text text-transparent">
          Log
        </span>
      </h1>

      <p className="mt-6 max-w-xl text-balance text-base leading-relaxed text-zinc-400 sm:text-lg">
        Drop a <span className="font-mono text-zinc-300">.bin</span> flight log
        and get an instant health report — what went wrong, why, and exactly how
        to make your vehicle fly better.
      </p>

      <div className="mt-10 flex items-center gap-2 text-xs text-zinc-500">
        <span>Scroll to explore</span>
        <svg
          className="h-4 w-4 animate-bounce"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 5v14m0 0-6-6m6 6 6-6" />
        </svg>
      </div>
    </header>
  )
}
