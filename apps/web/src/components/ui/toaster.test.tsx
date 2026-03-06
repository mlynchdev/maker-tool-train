/** @vitest-environment jsdom */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ToastViewport, useErrorToasts } from './toaster'

function ToastHarness() {
  const { toasts, pushErrorToast, dismissToast } = useErrorToasts()

  return (
    <div>
      <button
        type='button'
        onClick={() => {
          for (let index = 1; index <= 5; index += 1) {
            pushErrorToast({
              title: `Error ${index}`,
              description: `Description ${index}`,
            })
          }
        }}
      >
        Trigger burst
      </button>
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}

describe('toaster', () => {
  it('keeps earlier error toasts visible during bursts', async () => {
    const user = userEvent.setup()

    render(<ToastHarness />)

    await user.click(screen.getByRole('button', { name: 'Trigger burst' }))

    expect(screen.getAllByRole('alert')).toHaveLength(5)
    expect(screen.getByText('Description 1')).toBeInTheDocument()
    expect(screen.getByText('Description 5')).toBeInTheDocument()

    await user.click(
      within(screen.getAllByRole('alert')[0]).getByRole('button', {
        name: 'Dismiss',
      }),
    )

    expect(screen.queryByText('Description 1')).not.toBeInTheDocument()
    expect(screen.getByText('Description 5')).toBeInTheDocument()
  })
})
