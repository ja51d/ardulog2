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
})
