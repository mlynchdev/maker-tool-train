import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import app from './dist/server/server.js'

const appRoot = path.dirname(fileURLToPath(import.meta.url))
const clientRoot = path.resolve(appRoot, 'dist/client')

function resolveStaticFile(pathname) {
  if (!(pathname === '/styles.css' || pathname.startsWith('/assets/'))) {
    return null
  }

  const relativePath = pathname.replace(/^\/+/, '')
  const candidate = path.resolve(clientRoot, relativePath)
  const allowedPrefix = `${clientRoot}${path.sep}`

  if (!(candidate === clientRoot || candidate.startsWith(allowedPrefix))) {
    return null
  }

  try {
    const stat = fs.statSync(candidate)
    if (!stat.isFile()) {
      return null
    }
  } catch {
    return null
  }

  return candidate
}

function createCacheHeader(pathname) {
  if (pathname.startsWith('/assets/')) {
    return 'public, max-age=31536000, immutable'
  }

  return 'public, max-age=300'
}

const host = process.env.HOST || '0.0.0.0'
const port = Number(process.env.PORT || '3000')

const server = Bun.serve({
  hostname: host,
  port,
  async fetch(request) {
    const url = new URL(request.url)
    const staticFilePath = resolveStaticFile(url.pathname)

    if (staticFilePath) {
      const headers = new Headers()
      headers.set('Cache-Control', createCacheHeader(url.pathname))
      return new Response(Bun.file(staticFilePath), { headers })
    }

    return app.fetch(request)
  },
})

console.log(`Started server: http://${server.hostname}:${server.port}`)
