import { Suspense, lazy, useRef, useState, type ReactNode } from 'react'
import { gsap, ScrollTrigger, useGSAP } from './lib/gsap'
import CursorTrail from './components/CursorTrail'
import ScrollProgress from './components/ScrollProgress'
import Header from './components/Header'
import Byline from './components/Byline'
import BentoCard from './components/BentoCard'
import SectionNav, { type NavItem } from './components/SectionNav'
import UploadCard, { type AnalyzeStatus } from './components/UploadCard'

// MapLibre renders on demand (idle when static) and each map is split into its
// own chunk so the initial paint stays light. recharts (telemetry / PID / FFT)
// is likewise split out. Each page mounts its heavy widget only when active.
const FlightMap2D = lazy(() => import('./components/FlightMap2D'))
const FlightMap3D = lazy(() => import('./components/FlightMap3D'))
const TelemetryGraphs = lazy(() => import('./components/TelemetryGraphs'))
const PidView = lazy(() => import('./components/PidView'))
const FftView = lazy(() => import('./components/FftView'))
import {
  BatteryCard,
  FlightSummaryCard,
  GpsEkfCard,
  ModesCard,
  MotorOutputsCard,
  PowerCard,
  ProblemsCard,
  RecommendationsCard,
  VibrationCard,
} from './components/AnalysisCards'
import { DEMO_ANALYSIS, type LogAnalysis } from './data/demoLog'
import { parseBinLog } from './data/parseLog'

type PageId = 'overview' | 'map' | 'telemetry' | 'pid' | 'fft' | 'health' | 'advice'

interface SectionDef extends NavItem {
  id: PageId
  index: string
  title: string
  subtitle: string
}

// One source of truth for both the tab nav and the page headers.
const SECTIONS = [
  { id: 'overview', label: 'Overview', index: '01', title: 'Overview', subtitle: 'Your flight at a glance' },
  { id: 'map', label: 'Map & 3D', index: '02', title: 'Where it flew', subtitle: 'Satellite route and 3D terrain' },
  { id: 'telemetry', label: 'Telemetry', index: '03', title: 'Telemetry', subtitle: 'Altitude, attitude, speed and power over time' },
  { id: 'pid', label: 'PID', index: '04', title: 'PID tuning', subtitle: 'Rate-controller demand vs achieved, per axis' },
  { id: 'fft', label: 'FFT', index: '05', title: 'Vibration FFT', subtitle: 'Gyro noise spectrum for harmonic-notch tuning' },
  { id: 'health', label: 'Health', index: '06', title: 'Vehicle health', subtitle: 'GPS, vibration and motor outputs' },
  { id: 'advice', label: 'Advice', index: '07', title: 'Findings and advice', subtitle: 'What went wrong and how to fly better' },
] as const satisfies readonly SectionDef[]

const NAV_ITEMS: readonly NavItem[] = SECTIONS.map((s) => ({ id: s.id, label: s.label }))

/** Centered loading placeholder used while a deferred chunk mounts. */
function Loading({ className, label }: { className: string; label: string }) {
  return (
    <div className={`flex items-center justify-center text-sm text-zinc-500 ${className}`}>
      <span className="animate-pulse">{label}</span>
    </div>
  )
}

/** A labelled dashboard page: numbered header + a bento grid of cards. */
function Section({ section, children }: { section: SectionDef; children: ReactNode }) {
  return (
    <section className="pt-2">
      <div data-reveal className="mb-5 flex items-baseline gap-4">
        <span className="font-mono text-sm font-medium text-sky-400/80">{section.index}</span>
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-zinc-100">{section.title}</h2>
          <p className="mt-0.5 text-sm text-zinc-500">{section.subtitle}</p>
        </div>
      </div>
      <div className="grid auto-rows-[minmax(168px,auto)] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {children}
      </div>
    </section>
  )
}

export default function App() {
  const dashRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<AnalyzeStatus>('idle')
  const [analysis, setAnalysis] = useState<LogAnalysis | null>(null)
  const [fileName, setFileName] = useState('')
  const [isSample, setIsSample] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [page, setPage] = useState<PageId>('overview')

  // Bring the dashboard top under the sticky nav into view.
  const scrollToDash = () => {
    requestAnimationFrame(() =>
      dashRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    )
  }

  const selectPage = (id: string) => {
    setPage(id as PageId)
    scrollToDash()
  }

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
        setPage('overview')
        requestAnimationFrame(() => {
          ScrollTrigger.refresh()
          scrollToDash()
        })
      })
      .catch((err: unknown) => {
        setParseError(err instanceof Error ? err.message : 'Could not parse this log.')
        setStatus('done')
      })
  }

  // Opt-in only: load the bundled sample so the dashboard can be explored
  // without a real file. Nothing is shown until the user asks for it.
  const loadSample = () => {
    setAnalysis(DEMO_ANALYSIS)
    setFileName(DEMO_ANALYSIS.fileName)
    setIsSample(true)
    setParseError(null)
    setStatus('done')
    setPage('overview')
    requestAnimationFrame(() => {
      ScrollTrigger.refresh()
      scrollToDash()
    })
  }

  // Download the current analysis as JSON — the user's own parsed data, built
  // and saved entirely client-side; nothing is uploaded anywhere.
  const exportJson = () => {
    if (!analysis) return
    const blob = new Blob([JSON.stringify(analysis, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${analysis.fileName.replace(/\.bin$/i, '') || 'analysis'}.analysis.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  // Fade + rise the active page's header and cards in on each page switch.
  // Re-runs whenever the analysis mounts or the page changes; fromTo guarantees
  // cards always end fully visible (no stuck-at-0 state).
  useGSAP(
    () => {
      if (!analysis || !dashRef.current) return
      const els = gsap.utils.toArray<HTMLElement>(
        dashRef.current.querySelectorAll('[data-bento-card], [data-reveal]'),
      )
      if (!els.length) return
      gsap.fromTo(
        els,
        { opacity: 0, y: 24 },
        { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out', stagger: 0.07, overwrite: true },
      )
    },
    { scope: dashRef, dependencies: [!!analysis, page] },
  )

  const active = SECTIONS.find((s) => s.id === page) ?? SECTIONS[0]

  const renderPage = (a: LogAnalysis) => {
    switch (active.id) {
      case 'map':
        return (
          <>
            <BentoCard className="sm:col-span-2 lg:col-span-4">
              <Suspense fallback={<Loading className="h-[360px] sm:h-[440px] lg:h-[520px]" label="Building 3D terrain view…" />}>
                <FlightMap3D a={a} />
              </Suspense>
            </BentoCard>
            <BentoCard className="sm:col-span-2 lg:col-span-4">
              <Suspense fallback={<Loading className="h-[300px] sm:h-[360px] lg:h-[420px]" label="Loading satellite map…" />}>
                <FlightMap2D a={a} />
              </Suspense>
            </BentoCard>
          </>
        )
      case 'telemetry':
        return (
          <BentoCard className="sm:col-span-2 lg:col-span-4">
            <Suspense fallback={<Loading className="h-[700px]" label="Loading telemetry…" />}>
              <TelemetryGraphs a={a} />
            </Suspense>
          </BentoCard>
        )
      case 'pid':
        return (
          <BentoCard className="sm:col-span-2 lg:col-span-4">
            <Suspense fallback={<Loading className="h-[560px]" label="Building PID tracking…" />}>
              <PidView a={a} />
            </Suspense>
          </BentoCard>
        )
      case 'fft':
        return (
          <BentoCard className="sm:col-span-2 lg:col-span-4">
            <Suspense fallback={<Loading className="h-[440px]" label="Computing FFT…" />}>
              <FftView a={a} />
            </Suspense>
          </BentoCard>
        )
      case 'health':
        return (
          <>
            <BentoCard>
              <GpsEkfCard a={a} />
            </BentoCard>
            <BentoCard>
              <VibrationCard a={a} />
            </BentoCard>
            <BentoCard className="sm:col-span-2">
              <MotorOutputsCard a={a} />
            </BentoCard>
          </>
        )
      case 'advice':
        return (
          <>
            <BentoCard className="sm:col-span-2 lg:col-span-2">
              <ProblemsCard a={a} />
            </BentoCard>
            <BentoCard className="sm:col-span-2 lg:col-span-2">
              <RecommendationsCard a={a} />
            </BentoCard>
          </>
        )
      default:
        return (
          <>
            <BentoCard className="sm:col-span-2 lg:col-span-2">
              <FlightSummaryCard a={a} />
            </BentoCard>
            <BentoCard className="sm:col-span-2 lg:col-span-2">
              <UploadCard status={status} fileName={fileName} isSample={isSample} error={parseError} onFile={handleFile} />
            </BentoCard>
            <BentoCard>
              <BatteryCard a={a} />
            </BentoCard>
            <BentoCard>
              <PowerCard a={a} />
            </BentoCard>
            <BentoCard className="sm:col-span-2">
              <ModesCard a={a} />
            </BentoCard>
          </>
        )
    }
  }

  return (
    <>
      <CursorTrail />
      <ScrollProgress />
      <Byline />
      <Header />

      <main className="mx-auto max-w-6xl px-4 pb-28 sm:px-6">
        {analysis ? (
          <div ref={dashRef} className="scroll-mt-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs text-zinc-500">
                {isSample ? 'Exploring sample data · ' : 'Analyzed · '}
                <span className="font-mono text-zinc-400">{fileName}</span>
              </p>
              <button
                type="button"
                onClick={exportJson}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-white/20 hover:text-zinc-100"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 4v12m0 0 4-4m-4 4-4-4" />
                  <path d="M4 18v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1" />
                </svg>
                Export JSON
              </button>
            </div>

            <SectionNav items={NAV_ITEMS} active={page} onSelect={selectPage} />

            <Section section={active}>{renderPage(analysis)}</Section>
          </div>
        ) : (
          <div className="flex min-h-[64vh] flex-col items-center justify-center py-12">
            <div className="w-full max-w-lg rounded-3xl border border-white/[0.07] bg-zinc-900/40 p-6 backdrop-blur-sm sm:p-8">
              <UploadCard status={status} fileName={fileName} isSample={false} error={parseError} onFile={handleFile} />
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
                Everything runs locally in your browser — your .bin never leaves your device.
              </p>
            </div>
          </div>
        )}

        <footer className="mt-16 flex flex-col items-center gap-2 text-center text-xs text-zinc-600">
          <p>ArduLog · an open analyzer for ArduPilot DataFlash logs. Not affiliated with the ArduPilot project.</p>
          <p>
            Drop your own <span className="font-mono text-zinc-500">.bin</span> — it's parsed locally in your browser; nothing is uploaded.
          </p>
        </footer>
      </main>
    </>
  )
}
