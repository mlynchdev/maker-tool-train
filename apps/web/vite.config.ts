import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'

function firstExisting(paths: string[]): string | undefined {
  return paths.find((filePath) => fs.existsSync(filePath))
}

function resolveHttpsConfig() {
  const appRoot = __dirname
  const keyPath =
    process.env.VITE_DEV_HTTPS_KEY_PATH ??
    firstExisting([
      path.resolve(appRoot, 'localhost-key.pem'),
      path.resolve(appRoot, 'localhost+1-key.pem'),
      path.resolve(appRoot, 'localhost+2-key.pem'),
      path.resolve(appRoot, 'localhost+3-key.pem'),
      path.resolve(appRoot, 'certs/localhost-key.pem'),
      path.resolve(appRoot, 'certs/localhost+1-key.pem'),
      path.resolve(appRoot, 'certs/localhost+2-key.pem'),
      path.resolve(appRoot, 'certs/localhost+3-key.pem'),
    ])

  const certPath =
    process.env.VITE_DEV_HTTPS_CERT_PATH ??
    firstExisting([
      path.resolve(appRoot, 'localhost.pem'),
      path.resolve(appRoot, 'localhost+1.pem'),
      path.resolve(appRoot, 'localhost+2.pem'),
      path.resolve(appRoot, 'localhost+3.pem'),
      path.resolve(appRoot, 'certs/localhost.pem'),
      path.resolve(appRoot, 'certs/localhost+1.pem'),
      path.resolve(appRoot, 'certs/localhost+2.pem'),
      path.resolve(appRoot, 'certs/localhost+3.pem'),
    ])

  if (!keyPath || !certPath) {
    return undefined
  }

  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  }
}

const https = resolveHttpsConfig()

export default defineConfig({
  server: {
    host: 'localhost',
    port: 3001,
    https,
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
