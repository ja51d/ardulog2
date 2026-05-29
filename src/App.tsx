import { Suspense, lazy, useRef, useState, type ReactNode } from 'react'
import { gsap, ScrollTrigger, useGSAP } from './lib/gsap'
import CursorTrail from './components/CursorTrail'
import ScrollProgress from './components/ScrollProgress'
import Header from './components/Header'
import BentoCard from './components/BentoCard'
import SectionNav, { type NavItem } from './components/SectionNav'
import InView from './components/InView'
import UploadCard, { type AnalyzeStatus } from './components/UploadCard'

// MapLibre renders on demand (idle when static) and each map is split into its
// own chunk so the initial paint stays light. The 2D + 3D satellite views.
const FlightMap2D = lazy(() => import('./components/FlightMap2D'))
const FlightMap3D = lazy(() => import('./components/FlightMap3D'))
// recharts is likewise split out so it doesn't weigh down the initial paint.
const TelemetryGraphs = lazy(() => import('./components/TelemetryGraphs'))
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

interface SectionDef extends NavItem {
  index: string
  title: string
  subtitle: string
}

// One source of truth for both the scroll-spy nav and the section headers.
const SECTIONS = [
  {
    id: 'overview',
    label: 'Overview',
    index: '01',
    title: 'Overview',
    subtitle: 'Your flight at a glance',
  },
  {
    id: 'map',
    label: 'Map',
    index: '02',
    title: 'Where it flew',
    subtitle: 'Satellite route and 3D terrain',
  },
  {
    id: 'telemetry',
    label: 'Telemetry',
    index: '03',
    title: 'Telemetry',
    subtitle: 'Altitude, attitude, speed and power over time',
  },
  {
    id: 'health',
    label: 'Health',
    index: '04',
    title: 'Vehicle health',
    subtitle: 'GPS, vibration and motor outputs',
  },
  {
    id: 'advice',
    label: 'Advice',
    index: '05',
    title: 'Findings and advice',
    subtitle: 'What went wrong and how to fly better',
  },
] as const satisfies readonly SectionDef[]

/** Centered loading placeholder used while a deferred chunk mounts. */
function Loading({ className, label }: { className: string; label: string }) {
  return (
    <div className={`flex items-center justify-center text-sm text-zinc-500 ${className}`}>
      <span className="animate-pulse">{label}</span>
    </div>
  )
}

/** A labelled dashboard section: numbered header + a bento grid of cards. */
function Section({
  section,
  children,
}: {
  section: SectionDef
  children: ReactNode
}) {
  return (
    <section id={section.id} className="scroll-mt-24 pt-14 first:pt-0">
      <div data-reveal className="mb-5 flex items-baseline gap-4">
        <span className="font-mono text-sm font-medium text-sky-400/80">
          {section.index}
        </span>
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-zinc-100">
            {section.title}
          </h2>
          <p className="mt-0.5 text-sm text-zinc-500">{section.subtitle}</p>
        </div>
      </div>
      <div className="grid auto-rows-[minmax(168px,auto)] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {children}
      </div>
    </section>
  )
}

const NAV_ITEMS: readonly NavItem[] = SECTIONS.map((s) => ({
  id: s.id,
  label: s.label,
}))

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

  // Stagger-fade each section header + bento card in as it scrolls into view.
  // Animates only transform (y) and opacity. useGSAP scopes + reverts on
  // unmount; we also explicitly kill the batched ScrollTriggers for good measure.
  useGSAP(
    () => {
      const els = gsap.utils.toArray<HTMLElement>(
        mainRef.current!.querySelectorAll('[data-bento-card], [data-reveal]'),
      )
      gsap.set(els, { opacity: 0, y: 40 })
      const triggers = ScrollTrigger.batch(els, {
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
    // so the freshly-rendered sections get their scroll-in animation wired.
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

            <SectionNav items={NAV_ITEMS} />

            {/* 01 — Overview */}
            <Section section={SECTIONS[0]}>
              <BentoCard className="sm:col-span-2 lg:col-span-2">
                <FlightSummaryCard a={analysis} />
              </BentoCard>
              <BentoCard className="sm:col-span-2 lg:col-span-2">
                <UploadCard
                  status={status}
                  fileName={fileName}
                  isSample={isSample}
                  error={parseError}
                  onFile={handleFile}
                />
              </BentoCard>
              <BentoCard>
                <BatteryCard a={analysis} />
              </BentoCard>
              <BentoCard>
                <PowerCard a={analysis} />
              </BentoCard>
              <BentoCard className="sm:col-span-2">
                <ModesCard a={analysis} />
              </BentoCard>
            </Section>

            {/* 02 — Map & 3D */}
            <Section section={SECTIONS[1]}>
              <BentoCard className="sm:col-span-2 lg:col-span-4">
                <InView
                  fallback={
                    <Loading
                      className="h-[360px] sm:h-[440px] lg:h-[520px]"
                      label="Building 3D terrain view…"
                    />
                  }
                >
                  <Suspense
                    fallback={
                      <Loading
                        className="h-[360px] sm:h-[440px] lg:h-[520px]"
                        label="Building 3D terrain view…"
                      />
                    }
                  >
                    <FlightMap3D a={analysis} />
                  </Suspense>
                </InView>
              </BentoCard>
              <BentoCard className="sm:col-span-2 lg:col-span-4">
                <InView
                  fallback={
                    <Loading
                      className="h-[300px] sm:h-[360px] lg:h-[420px]"
                      label="Loading satellite map…"
                    />
                  }
                >
                  <Suspense
                    fallback={
                      <Loading
                        className="h-[300px] sm:h-[360px] lg:h-[420px]"
                        label="Loading satellite map…"
                      />
                    }
                  >
                    <FlightMap2D a={analysis} />
                  </Suspense>
                </InView>
              </BentoCard>
            </Section>

            {/* 03 — Telemetry */}
            <Section section={SECTIONS[2]}>
              <BentoCard className="sm:col-span-2 lg:col-span-4">
                <InView fallback={<Loading className="h-[700px]" label="Loading telemetry…" />}>
                  <Suspense
                    fallback={<Loading className="h-[700px]" label="Loading telemetry…" />}
                  >
                    <TelemetryGraphs a={analysis} />
                  </Suspense>
                </InView>
              </BentoCard>
            </Section>

            {/* 04 — Health */}
            <Section section={SECTIONS[3]}>
              <BentoCard>
                <GpsEkfCard a={analysis} />
              </BentoCard>
              <BentoCard>
                <VibrationCard a={analysis} />
              </BentoCard>
              <BentoCard className="sm:col-span-2">
                <MotorOutputsCard a={analysis} />
              </BentoCard>
            </Section>

            {/* 05 — Findings & advice */}
            <Section section={SECTIONS[4]}>
              <BentoCard className="sm:col-span-2 lg:col-span-2">
                <ProblemsCard a={analysis} />
              </BentoCard>
              <BentoCard className="sm:col-span-2 lg:col-span-2">
                <RecommendationsCard a={analysis} />
              </BentoCard>
            </Section>
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
