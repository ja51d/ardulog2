# ArduLog

Web viewer for **ArduPilot** UAV flight logs. Drop a
DataFlash `.bin` log and ArduLog surfaces a flight-health report — what went
wrong, why, and concrete parameter-level recommendations to make your vehicle
fly better.

> **Status:** UI preview. The full in-browser DataFlash (`.bin`) binary parser
> is on the roadmap; the app currently renders a representative sample analysis
> so the interface and workflow can be built and reviewed end to end.

## Features

- **Responsive Bento grid** of asymmetric cards on a dark (`zinc-950`) canvas
  with subtle grid lines and rounded corners.
- **Mouse-follow border glow** — each card's border lights up via a
  radial gradient that tracks the cursor (driven by CSS custom properties, no
  re-renders).
- **Glowing cursor trail** — a GPU-composited comet trail (single
  `requestAnimationFrame` loop, `transform`/`opacity` only).
- **GSAP scroll animations** — cards stagger-fade in as they enter the viewport
  (`ScrollTrigger.batch`), and the hero wordmark scales with scroll progress.
  A top bar tracks absolute document scroll percentage.
- Flight summary, battery health, GPS/EKF status, vibration, detected problems,
  and tuning recommendations cards.

## Tech stack

- [Vite](https://vite.dev) + React 19 + TypeScript
- [Tailwind CSS v4](https://tailwindcss.com)
- [GSAP](https://gsap.com) + [@gsap/react](https://github.com/greensock/react)

## Getting started

```bash
npm install
npm run dev      # start the dev server
npm run build    # type-check + production build
npm run preview  # preview the production build
```

## Performance notes

- Animations use only hardware-accelerated properties (`transform`, `opacity`).
- All GSAP work runs inside `useGSAP`, which reverts tweens and kills
  ScrollTriggers on unmount; the cursor-trail `rAF` loop and its listeners are
  torn down in the effect cleanup.
- The cursor trail is disabled for coarse pointers and when the user prefers
  reduced motion.

---

Not affiliated with the ArduPilot project. ArduPilot is a trademark of its
respective owners.
