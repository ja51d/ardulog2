/**
 * Fixed top-right credit: "BY JAVID" in spaced caps with the GitHub profile
 * (@ja51d) linked underneath — matching the requested look.
 */
export default function Byline() {
  return (
    <div className="fixed right-4 top-4 z-50 flex flex-col items-end gap-0.5 text-right sm:right-5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.28em] text-zinc-300">
        by Javid
      </span>
      <a
        href="https://github.com/ja51d"
        target="_blank"
        rel="noreferrer noopener"
        className="group inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500 transition-colors hover:text-sky-300"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.55-1.14-4.55-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.36 9.36 0 0 1 2.5-.34c.85 0 1.71.12 2.5.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.79-4.57 5.05.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.6.69.49A10.26 10.26 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z" />
        </svg>
        @ja51d
      </a>
    </div>
  )
}
