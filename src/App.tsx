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
// recharts is likewise split out so it doesn't weigh down the initial paint.
const TelemetryGraphs = lazy(() => import('./components/TelemetryGraphs'))
import {
  BatteryCard,
  FlightSummaryCard,
  GpsEkfCard,
  ModesCard,
  ProblemsCard,
  RecommendationsCard,
  VibrationCard,
} from './components/AnalysisCards'
import { DEMO_ANALYSIS, type LogAnalysis } from './data/demoLog'
import { parseBinLog } from './data/parseLog'

export default function App() {
  const mainRef = useRef<HTMLElement>(null)
  const [status, setStatus] = useState<AnalyzeStatus>('done')
  const [analysis, setAnalysis] = useState<LogAnalysis>(DEMO_ANALYSIS)
  const [fileName, setFileName] = useState(DEMO_ANALYSIS.fileName)
  const [isSample, setIsSample] = useState(true)
  const [parseError, setParseError] = useState<string | null>(null)

  const handleFile = (file: File) => {
    setFileName(file.name)
    setParseError(null)
    setStatus('analyzing')
    file
      .arrayBuffer()
      .then((buf) => {
        const parsed = parseBinLog(buf, file.name)
        setAnalysis(parsed)
        setIsSample(false)
        setStatus('done')
        // New cards/series changed the page height — re-measure scroll triggers.
        requestAnimationFrame(() => ScrollTrigger.refresh())
      })
      .catch((err: unknown) => {
        setParseError(err instanceof Error ? err.message : 'Could not parse this log.')
        setStatus('done')
      })
  }

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

          <BentoCard className="sm:col-span-2 lg:col-span-4">
            <Suspense
              fallback={
                <div className="flex h-[700px] items-center justify-center text-sm text-zinc-500">
                  <span className="animate-pulse">Loading telemetry…</span>
                </div>
              }
            >
              <TelemetryGraphs a={analysis} />
            </Suspense>
          </BentoCard>

          <BentoCard className="sm:col-span-2 lg:col-span-2 lg:row-span-2">
            <UploadCard
              status={status}
              fileName={fileName}
              isSample={isSample}
              error={parseError}
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
            Drop your own <span className="font-mono text-zinc-500">.bin</span> —
            it's parsed locally in your browser; nothing is uploaded.
          </p>
        </footer>
      </main>
    </>
  )
}
