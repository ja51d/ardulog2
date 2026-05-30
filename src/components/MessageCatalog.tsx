import { useMemo, useState } from 'react'
import type { LogAnalysis } from '../data/demoLog'
import { CardTitle } from './ui'

/**
 * Every message type the log contains — record counts, average logging rate,
 * and the columns each message declares. Searchable and expandable, mirroring
 * the "log contents" view of a ground station.
 */
export default function MessageCatalog({ a }: { a: LogAnalysis }) {
  const messages = a.messages
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())

  const totalRecords = useMemo(
    () => messages.reduce((s, m) => s + m.count, 0),
    [messages],
  )
  const maxCount = useMemo(
    () => messages.reduce((m, x) => Math.max(m, x.count), 1),
    [messages],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase()
    if (!q) return messages
    return messages.filter(
      (m) =>
        m.type.toUpperCase().includes(q) ||
        m.fields.some((f) => f.toUpperCase().includes(q)),
    )
  }, [messages, query])

  const toggle = (type: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })

  return (
    <div className="flex h-full flex-col">
      <CardTitle
        title="Log contents"
        hint={`${messages.length} types · ${totalRecords.toLocaleString()} records`}
        icon={
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
            <path d="M3 9h18M9 9v11" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        }
      />

      {messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-white/10 py-16 text-center text-xs text-zinc-500">
          No message statistics are available for this log.
        </div>
      ) : (
        <>
          <label className="relative mb-3 block">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
              <path d="m20 20-3-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span className="sr-only">Filter messages by type or field</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              inputMode="search"
              aria-label="Filter messages by type or field"
              placeholder="Filter by message or field — IMU, ATT, GPS…"
              className="w-full rounded-xl border border-white/[0.08] bg-white/[0.02] py-2 pl-9 pr-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-sky-500/40 focus:outline-none focus:ring-1 focus:ring-sky-500/30"
            />
          </label>

          <div className="flex items-center gap-3 px-3 pb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-600">
            <span className="w-3" />
            <span className="flex-1">Type</span>
            <span className="w-24 text-right">Count</span>
            <span className="w-20 text-right">Rate</span>
          </div>

          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-zinc-500">
                No message types match “{query}”.
              </p>
            ) : (
              filtered.map((m) => {
                const isOpen = open.has(m.type)
                return (
                  <div key={m.type}>
                    <button
                      type="button"
                      onClick={() => toggle(m.type)}
                      aria-expanded={isOpen}
                      className="group relative flex w-full items-center gap-3 overflow-hidden rounded-lg px-3 py-2 text-left transition hover:bg-white/[0.03]"
                    >
                      <span
                        className="absolute inset-y-0 left-0 bg-gradient-to-r from-sky-500/[0.12] to-transparent"
                        style={{ width: `${(m.count / maxCount) * 100}%` }}
                        aria-hidden
                      />
                      <svg
                        className={`relative h-3 w-3 shrink-0 text-zinc-500 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden
                      >
                        <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="relative flex-1 truncate font-mono text-sm text-zinc-100">
                        {m.type}
                        <span className="ml-2 text-[11px] text-zinc-600">{m.fields.length} fields</span>
                      </span>
                      <span className="relative w-24 text-right font-mono text-sm tabular-nums text-zinc-300">
                        {m.count.toLocaleString()}
                      </span>
                      <span className="relative w-20 text-right font-mono text-xs tabular-nums text-zinc-500">
                        {m.rateHz.toFixed(1)} Hz
                      </span>
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-2.5 pl-9">
                        <div className="flex flex-wrap gap-1.5">
                          {m.fields.length ? (
                            m.fields.map((f) => (
                              <span
                                key={f}
                                className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[11px] text-zinc-400 ring-1 ring-inset ring-white/[0.06]"
                              >
                                {f}
                              </span>
                            ))
                          ) : (
                            <span className="text-[11px] text-zinc-600">No field labels declared.</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </>
      )}
    </div>
  )
}
