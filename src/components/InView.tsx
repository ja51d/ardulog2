import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Defers rendering its children until the element scrolls within `rootMargin`
 * of the viewport. Heavy, lazily-imported widgets (the MapLibre maps, the
 * recharts telemetry) only fetch their chunks + tiles and spin up once the
 * user actually approaches them — keeping the dashboard light on first paint.
 * The fallback reserves the same height so scroll positions stay stable.
 */
export default function InView({
  children,
  fallback,
  rootMargin = '400px',
}: {
  children: ReactNode
  fallback: ReactNode
  rootMargin?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (shown) return
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true)
          obs.disconnect()
        }
      },
      { rootMargin },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [shown, rootMargin])

  return (
    <div ref={ref} className="flex h-full flex-col">
      {shown ? children : fallback}
    </div>
  )
}
