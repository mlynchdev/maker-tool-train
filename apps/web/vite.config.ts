import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 3001,
  },
  plugins: [
    tsconfigPaths(),
    tanstackStart(),
  ],
  esbuild: {
    jsx: 'automatic',
  },
  build: {
    rollupOptions: {
      external: (id) => {
        const serverOnlyPackages = ['postgres', 'argon2', 'drizzle-orm']
        return serverOnlyPackages.some((pkg) => id.includes(pkg))
      },
    },
  },
  ssr: {
    external: ['postgres', 'drizzle-orm', 'argon2'],
    noExternal: ['@tanstack/react-start', '@tanstack/react-router'],
  },
})
