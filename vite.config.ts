import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // @react-three/fiber ships its own react-reconciler; without deduping, the
  // lazily-loaded 3D chunk can pull in a second copy of React and trip
  // "Invalid hook call". Force a single shared React instance.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  // Pre-bundle the heavy, lazily-imported recharts chunk against that single
  // React at startup, so the dev dep-optimizer can't link a second copy of
  // React when the chunk is first requested (also an "Invalid hook call").
  optimizeDeps: {
    include: ['recharts'],
  },
  build: {
    // maplibre-gl is a single ~1 MB WebGL library. It's already lazy-loaded
    // (only the map sections request it) and can't be split further, so raise
    // the ceiling instead of chasing an un-splittable vendor chunk.
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          // Pull the big WebGL lib out of the flight-map helper chunk so it
          // caches on its own — app-code edits no longer re-download 1 MB.
          if (id.includes('node_modules/maplibre-gl/')) return 'maplibre'
          // GSAP drives the cursor trail + scroll progress; stable, cache apart.
          if (id.includes('node_modules/gsap/') || id.includes('node_modules/@gsap/'))
            return 'gsap'
          // React core in one chunk: exactly one copy, cached across deploys.
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/scheduler/')
          )
            return 'react-vendor'
          // Everything else (recharts, react-is, …) keeps Rollup's defaults.
        },
      },
    },
  },
})
