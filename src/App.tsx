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
  GroundTrackCard,
  ModesCard,
  MotorOutputsCard,
  PowerCard,
  ProblemsCard,
  RecommendationsCard,
  VibrationCard,
} from './components/AnalysisCards'
import { DEMO_ANALYSIS, type LogAnalysis } from './data/demoLog'
import { parseBinLog } from './data/parseLog'

export default function App() {
  const mainRef = useRef<HTMLElement>(null)
  const [status, setStatus] = useState<AnalyzeStatus>('idle')
  const [analysis, setAnalysis] = useState<LogAnalysis | null>(null)
  const [fileName, setFileName] = useState('')
  const [isSample, setIsSample] = useState(false)
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

  // Opt-in only: load the bundled sample analysis so the dashboard can be
  // explored without a real file. Nothing is shown until the user asks for it.
  const loadSample = () => {
    setAnalysis(DEMO_ANALYSIS)
    setFileName(DEMO_ANALYSIS.fileName)
    setIsSample(true)
    setParseError(null)
    setStatus('done')
    requestAnimationFrame(() => ScrollTrigger.refresh())
  }

  // Download the current analysis as JSON — the user's own parsed data, built
  // and saved entirely client-side; nothing is uploaded anywhere.
  const exportJson = () => {
    if (!analysis) return
    const blob = new Blob([JSON.stringify(analysis, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${analysis.fileName.replace(/\.bin$/i, '') || 'analysis'}.analysis.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
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
    // Re-run once the dashboard actually mounts (analysis goes from null → set),
    // so the freshly-rendered bento cards get their scroll-in animation wired.
    { scope: mainRef, dependencies: [!!analysis] },
  )

  return (
    <>
      <CursorTrail />
      <ScrollProgress />
      <Header />

      <main ref={mainRef} className="mx-auto max-w-6xl px-4 pb-28 sm:px-6">
        {analysis ? (
          <>
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-xs text-zinc-500">
                {isSample ? 'Exploring sample data · ' : 'Analyzed · '}
                <span className="font-mono text-zinc-400">{fileName}</span>
              </p>
              <button
                type="button"
                onClick={exportJson}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-white/20 hover:text-zinc-100"
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M12 4v12m0 0 4-4m-4 4-4-4" />
                  <path d="M4 18v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1" />
                </svg>
                Export JSON
              </button>
            </div>

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
                <PowerCard a={analysis} />
              </BentoCard>

              <BentoCard className="sm:col-span-2 lg:col-span-2 lg:row-span-2">
                <GroundTrackCard a={analysis} />
              </BentoCard>

              <BentoCard>
                <GpsEkfCard a={analysis} />
              </BentoCard>

              <BentoCard>
                <VibrationCard a={analysis} />
              </BentoCard>

              <BentoCard className="sm:col-span-2 lg:col-span-2 lg:row-span-2">
                <ProblemsCard a={analysis} />
              </BentoCard>

              <BentoCard className="sm:col-span-2 lg:col-span-2">
                <MotorOutputsCard a={analysis} />
              </BentoCard>

              <BentoCard>
                <ModesCard a={analysis} />
              </BentoCard>

              <BentoCard className="sm:col-span-2 lg:col-span-2">
                <RecommendationsCard a={analysis} />
              </BentoCard>
            </div>
          </>
        ) : (
          <div className="flex min-h-[64vh] flex-col items-center justify-center py-12">
            <div className="w-full max-w-lg rounded-3xl border border-white/[0.07] bg-zinc-900/40 p-6 backdrop-blur-sm sm:p-8">
              <UploadCard
                status={status}
                fileName={fileName}
                isSample={false}
                error={parseError}
                onFile={handleFile}
              />
            </div>
            <div className="mt-6 flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={loadSample}
                className="group inline-flex items-center gap-2 text-sm text-zinc-400 transition-colors hover:text-sky-300"
              >
                Don't have a log handy? Explore with sample data
                <span className="transition-transform group-hover:translate-x-0.5">→</span>
              </button>
              <p className="max-w-sm text-center text-[11px] leading-relaxed text-zinc-600">
                Everything runs locally in your browser — your .bin never leaves
                your device.
              </p>
            </div>
          </div>
        )}

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
