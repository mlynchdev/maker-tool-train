import { describe, expect, it, vi } from 'vitest'
import { EventBus } from './events'

describe('EventBus', () => {
  it('delivers published events to subscribers', () => {
    const bus = new EventBus()
    const callback = vi.fn()

    bus.subscribe('test', 'user-1', callback)
    bus.publish('test', { value: 42 })

    expect(callback).toHaveBeenCalledWith({ value: 42 })
  })

  it('stops delivering events after unsubscribe', () => {
    const bus = new EventBus()
    const callback = vi.fn()

    const unsubscribe = bus.subscribe('test', 'user-1', callback)
    unsubscribe()
    bus.publish('test', { value: 42 })

    expect(callback).not.toHaveBeenCalled()
  })

  it('targets a specific user with publishToUser', () => {
    const bus = new EventBus()
    const user1Cb = vi.fn()
    const user2Cb = vi.fn()

    bus.subscribeToUser('user-1', user1Cb)
    bus.subscribeToUser('user-2', user2Cb)
    bus.publishToUser('user-1', 'greeting', { message: 'hello' })

    expect(user1Cb).toHaveBeenCalledWith({
      event: 'greeting',
      data: { message: 'hello' },
    })
    expect(user2Cb).not.toHaveBeenCalled()
  })

  it('broadcasts to all user channels', () => {
    const bus = new EventBus()
    const user1Cb = vi.fn()
    const user2Cb = vi.fn()

    bus.subscribeToUser('user-1', user1Cb)
    bus.subscribeToUser('user-2', user2Cb)
    bus.broadcast('refresh', { scope: 'all' })

    expect(user1Cb).toHaveBeenCalledWith({
      event: 'refresh',
      data: { scope: 'all' },
    })
    expect(user2Cb).toHaveBeenCalledWith({
      event: 'refresh',
      data: { scope: 'all' },
    })
  })

  it('does not break other subscribers when one throws', () => {
    const bus = new EventBus()
    const errorCb = vi.fn(() => {
      throw new Error('boom')
    })
    const normalCb = vi.fn()

    bus.subscribe('test', 'user-1', errorCb)
    bus.subscribe('test', 'user-2', normalCb)
    bus.publish('test', 'data')

    expect(errorCb).toHaveBeenCalled()
    expect(normalCb).toHaveBeenCalledWith('data')
  })
})
