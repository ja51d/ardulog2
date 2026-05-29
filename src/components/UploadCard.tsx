import { useRef, useState } from 'react'

export type AnalyzeStatus = 'idle' | 'analyzing' | 'done'

interface UploadCardProps {
  status: AnalyzeStatus
  fileName: string
  isSample: boolean
  /** Parse failure surfaced by the parent after reading the file. */
  error?: string | null
  onFile: (file: File) => void
}

export default function UploadCard({
  status,
  fileName,
  isSample,
  error,
  onFile,
}: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const accept = (file: File | undefined) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.bin')) {
      setLocalError('Please drop an ArduPilot DataFlash .bin log.')
      return
    }
    setLocalError(null)
    onFile(file)
  }

  const shownError = localError ?? error

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center gap-2">
        <h3 className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">
          Flight log
        </h3>
        {status === 'done' && (
          <span
            className={`ml-auto rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${
              isSample
                ? 'bg-zinc-500/10 text-zinc-400 ring-zinc-500/30'
                : 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/30'
            }`}
          >
            {isSample ? 'Sample data' : 'Analyzed'}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          accept(e.dataTransfer.files?.[0])
        }}
        className={`group/drop relative flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-8 text-center transition-colors duration-300 ${
          dragOver
            ? 'border-sky-400/70 bg-sky-400/5'
            : 'border-white/10 hover:border-white/20'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".bin"
          className="hidden"
          onChange={(e) => accept(e.target.files?.[0])}
        />

        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500/20 to-purple-500/20 text-sky-300 ring-1 ring-inset ring-white/10">
          {status === 'analyzing' ? (
            <svg
              className="h-5 w-5 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                cx="12"
                cy="12"
                r="9"
                stroke="currentColor"
                strokeOpacity="0.25"
                strokeWidth="3"
              />
              <path
                d="M21 12a9 9 0 0 0-9-9"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 16V4m0 0L8 8m4-4 4 4" />
              <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
          )}
        </span>

        {status === 'analyzing' ? (
          <p className="text-sm text-zinc-300">
            Analyzing{' '}
            <span className="font-mono text-sky-300">{fileName}</span>…
          </p>
        ) : (
          <>
            <p className="text-sm text-zinc-300">
              <span className="font-medium text-zinc-100">
                Drop your .bin log
              </span>{' '}
              or click to browse
            </p>
            <p className="font-mono text-xs text-zinc-500">
              currently showing: {fileName}
            </p>
          </>
        )}
      </button>

      {shownError && <p className="mt-3 text-xs text-rose-400">{shownError}</p>}
      <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
        Files stay on your device — the DataFlash log is parsed locally in your
        browser. {isSample ? 'Showing bundled sample data until you drop a log.' : ''}
      </p>
    </div>
  )
}
