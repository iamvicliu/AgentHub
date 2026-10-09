import { EventEmitter } from 'node:events'

import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vite-plus/test'

const workers = vi.hoisted(() => ({ current: null as EventEmitter | null, bootExit: false }))
vi.mock('node:worker_threads', () => ({
  Worker: class extends EventEmitter {
    constructor() {
      super()
      workers.current = this
      setImmediate(() =>
        workers.bootExit ? this.emit('exit', 1) : this.emit('message', { type: 'ready' }),
      )
    }
    postMessage() {}
    terminate() {
      return Promise.resolve(0)
    }
  },
}))

import { spawnScanWorker } from './scan-worker-proxy.js'

describe('scan worker lifecycle', () => {
  it('fails boot immediately when the worker exits without ready', async () => {
    workers.bootExit = true
    await expect(spawnScanWorker('/tmp/fixture.mjs')).rejects.toThrow('exited before ready')
    workers.bootExit = false
  })

  it('rejects commands and cached status after exit instead of hanging', async () => {
    const proxy = await spawnScanWorker('/tmp/fixture.mjs')
    workers.current!.emit('message', {
      type: 'event-status',
      status: { currentProfile: 'regex@fixture' },
    })
    workers.current!.emit('exit', 1)
    await expect(Effect.runPromise(proxy.rescanAll())).rejects.toThrow('exited')
    await expect(Effect.runPromise(proxy.getStatus)).rejects.toThrow('exited')
    await expect(proxy.shutdown()).resolves.toBeUndefined()
  })
})
