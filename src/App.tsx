import { Suspense, lazy, useRef, useState } from 'react'
import { gsap, ScrollTrigger, useGSAP } from './lib/gsap'
import CursorTrail from './components/CursorTrail'
import ScrollProgress from './components/ScrollProgress'
import Header from './components/Header'
import BentoCard from './components/BentoCard'
import UploadCard, { type AnalyzeStatus } from './components/UploadCard'

// three.js + R3F is a heavy dependency — split it into its own chunk and load
// it on demand so the initial paint stays light.
const FlightPath3D = lazy(() => import('./components/FlightPath3D'))
import {
  BatteryCard,
  FlightSummaryCard,
  GpsEkfCard,
  ModesCard,
  ProblemsCard,
  RecommendationsCard,
  VibrationCard,
} from './components/AnalysisCards'
import { DEMO_ANALYSIS } from './data/demoLog'

export default function App() {
  const mainRef = useRef<HTMLElement>(null)
  const timerRef = useRef<number | undefined>(undefined)
  const [status, setStatus] = useState<AnalyzeStatus>('done')
  const [fileName, setFileName] = useState(DEMO_ANALYSIS.fileName)
  const [isSample, setIsSample] = useState(true)

  const handleFile = (file: File) => {
    window.clearTimeout(timerRef.current)
    setFileName(file.name)
    setIsSample(false)
    setStatus('analyzing')
    timerRef.current = window.setTimeout(() => {
      setStatus('done')
      ScrollTrigger.refresh()
    }, 1400)
  }

  const analysis = { ...DEMO_ANALYSIS, fileName }

  // Stagger-fade each bento card in as it scrolls into view. Animates only
  // transform (y) and opacity. useGSAP scopes + reverts everything on unmount;
  // we also explicitly kill the batched ScrollTriggers for good measure.
  useGSAP(
    () => {
      const cards = gsap.utils.toArray<HTMLElement>(
        mainRef.current!.querySelectorAll('[data-bento-card]'),
      )
      gsap.set(cards, { opacity: 0, y: 40 })
      const triggers = ScrollTrigger.batch(cards, {
        start: 'top 88%',
        once: true,
        onEnter: (batch) =>
          gsap.to(batch, {
            opacity: 1,
            y: 0,
            duration: 0.7,
            ease: 'power3.out',
            stagger: 0.12,
            overwrite: true,
          }),
      })
      return () => triggers.forEach((t) => t.kill())
    },
    { scope: mainRef },
  )

  return (
    <>
      <CursorTrail />
      <ScrollProgress />
      <Header />

      <main ref={mainRef} className="mx-auto max-w-6xl px-4 pb-28 sm:px-6">
        <div className="grid auto-rows-[minmax(168px,auto)] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <BentoCard className="sm:col-span-2 lg:col-span-4">
            <Suspense
              fallback={
                <div className="flex h-[320px] items-center justify-center text-sm text-zinc-500 sm:h-[380px] lg:h-[460px]">
                  <span className="animate-pulse">Initializing 3D flight view…</span>
                </div>
              }
            >
              <FlightPath3D a={analysis} />
            </Suspense>
          </BentoCard>

          <BentoCard className="sm:col-span-2 lg:col-span-2 lg:row-span-2">
            <UploadCard
              status={status}
              fileName={fileName}
              isSample={isSample}
              onFile={handleFile}
            />
          </BentoCard>

          <BentoCard className="sm:col-span-2 lg:col-span-2">
            <FlightSummaryCard a={analysis} />
          </BentoCard>

          <BentoCard>
            <BatteryCard a={analysis} />
          </BentoCard>

          <BentoCard>
            <GpsEkfCard a={analysis} />
          </BentoCard>

          <BentoCard className="sm:col-span-2 lg:col-span-2 lg:row-span-2">
            <ProblemsCard a={analysis} />
          </BentoCard>

          <BentoCard>
            <VibrationCard a={analysis} />
          </BentoCard>

          <BentoCard>
            <ModesCard a={analysis} />
          </BentoCard>

          <BentoCard className="sm:col-span-2 lg:col-span-2">
            <RecommendationsCard a={analysis} />
          </BentoCard>
        </div>

        <footer className="mt-16 flex flex-col items-center gap-2 text-center text-xs text-zinc-600">
          <p>
            ArduLog · an open analyzer for ArduPilot DataFlash logs. Not
            affiliated with the ArduPilot project.
          </p>
          <p>
            Drop a real <span className="font-mono text-zinc-500">.bin</span> to
            see the workflow — full binary parsing is on the roadmap.
          </p>
        </footer>
      </main>
    </>
  )
}
