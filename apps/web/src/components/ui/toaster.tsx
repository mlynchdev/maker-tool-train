import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '~/lib/utils'

type ToastTone = 'error'

interface ToastRecord {
  id: string
  title: string
  description: string
  tone: ToastTone
}

interface ErrorToastInput {
  title?: string
  description: string
}

interface ToastViewportProps {
  toasts: ToastRecord[]
  onDismiss: (id: string) => void
}

function getToastToneClass(tone: ToastTone) {
  if (tone === 'error') {
    return 'border-destructive/60 bg-destructive/10 text-destructive'
  }

  return 'border-border bg-card text-card-foreground'
}

function createToastId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function useErrorToasts() {
  const [toasts, setToasts] = useState<ToastRecord[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismissToast = useCallback((id: string) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id))

    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
  }, [])

  const pushErrorToast = useCallback(
    (input: ErrorToastInput) => {
      const id = createToastId()
      const toast: ToastRecord = {
        id,
        title: input.title || 'Request failed',
        description: input.description,
        tone: 'error',
      }

      setToasts((previous) => [...previous, toast].slice(-4))

      const timer = setTimeout(() => {
        dismissToast(id)
      }, 5000)
      timersRef.current.set(id, timer)
    },
    [dismissToast]
  )

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer)
      }
      timersRef.current.clear()
    }
  }, [])

  return {
    toasts,
    pushErrorToast,
    dismissToast,
  }
}

export function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[120] flex justify-center px-4">
      <div className="flex w-full max-w-md flex-col gap-2">
        {toasts.map((toast) => (
          <section
            key={toast.id}
            className={cn(
              'pointer-events-auto rounded-lg border px-4 py-3 shadow-lg',
              getToastToneClass(toast.tone)
            )}
            role="alert"
            aria-live="assertive"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{toast.title}</p>
                <p className="mt-1 text-sm leading-relaxed opacity-90">{toast.description}</p>
              </div>
              <button
                type="button"
                className="text-xs font-medium underline underline-offset-2 opacity-75 transition hover:opacity-100"
                onClick={() => onDismiss(toast.id)}
              >
                Dismiss
              </button>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
