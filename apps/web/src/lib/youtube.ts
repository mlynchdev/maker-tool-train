const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/
const LOOSE_ID_WITH_SUFFIX_REGEX = /^([a-zA-Z0-9_-]{11})(?:[?&].*)?$/
const EMBED_SRC_REGEX = /src=["']([^"']+)["']/i
const LOOSE_YOUTUBE_ID_REGEX =
  /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?.*v=|embed\/|shorts\/|live\/))([a-zA-Z0-9_-]{11})/i

export function normalizeYouTubeId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (YOUTUBE_ID_REGEX.test(trimmed)) {
    return trimmed
  }

  const idWithSuffixMatch = trimmed.match(LOOSE_ID_WITH_SUFFIX_REGEX)
  if (idWithSuffixMatch && idWithSuffixMatch[1]) {
    return idWithSuffixMatch[1]
  }

  // Support pasted iframe embed snippets by extracting src URL first.
  const embedSrcMatch = trimmed.match(EMBED_SRC_REGEX)
  if (embedSrcMatch?.[1]) {
    return normalizeYouTubeId(embedSrcMatch[1])
  }

  let urlString = trimmed
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(urlString)) {
    if (urlString.startsWith('www.')) {
      urlString = `https://${urlString}`
    } else if (urlString.includes('youtube.com') || urlString.includes('youtu.be')) {
      urlString = `https://${urlString}`
    }
  }

  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    return null
  }

  const host = url.hostname.replace(/^www\./, '')
  let id: string | null = null

  if (host === 'youtu.be') {
    id = url.pathname.split('/').filter(Boolean)[0] || null
  } else if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    id = url.searchParams.get('v')

    if (!id) {
      const parts = url.pathname.split('/').filter(Boolean)
      const embedIndex = parts.indexOf('embed')
      const shortsIndex = parts.indexOf('shorts')
      const liveIndex = parts.indexOf('live')

      if (embedIndex !== -1 && parts[embedIndex + 1]) {
        id = parts[embedIndex + 1]
      } else if (shortsIndex !== -1 && parts[shortsIndex + 1]) {
        id = parts[shortsIndex + 1]
      } else if (liveIndex !== -1 && parts[liveIndex + 1]) {
        id = parts[liveIndex + 1]
      }
    }
  }

  if (!id) {
    const looseMatch = trimmed.match(LOOSE_YOUTUBE_ID_REGEX)
    if (!looseMatch?.[1]) return null
    id = looseMatch[1]
  }

  const cleaned = id.split(/[?&]/)[0]
  if (!YOUTUBE_ID_REGEX.test(cleaned)) return null

  return cleaned
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
