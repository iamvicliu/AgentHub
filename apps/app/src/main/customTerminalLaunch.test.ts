import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  spawn: vi.fn(),
  existsSync: vi.fn(() => true),
}))
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  execFileSync: mocks.execFileSync,
  spawn: mocks.spawn,
}))
vi.mock('node:fs', () => ({
  existsSync: mocks.existsSync,
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  readdirSync: vi.fn(() => []),
}))
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))
import { openTerminal, discoverTerminals } from './terminal.js'

const entry = {
  id: 'custom:test',
  name: 'Test',
  executable: '/Applications/My Terminal.app',
  args: ['-e', 'sh', '-c', '{command}'],
}
describe('custom terminal launching', () => {
  it('passes app path and command as separate arguments without an outer shell', () => {
    void openTerminal("echo 'test'", entry.id, '/tmp/My Project', [entry])
    expect(mocks.execFileSync).toHaveBeenCalledWith(
      '/usr/bin/open',
      [
        '-na',
        entry.executable,
        '--args',
        '-e',
        'sh',
        '-c',
        "cd '/tmp/My Project' && echo 'test'; exec $SHELL",
      ],
      { timeout: 10000, env: expect.any(Object) },
    )
  })
  it('reports executable spawn failure to the caller', async () => {
    mocks.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
      queueMicrotask(() => child.emit('error', new Error('permission denied')))
      return child
    })
    await expect(
      openTerminal('echo test', entry.id, undefined, [{ ...entry, executable: '/tmp/terminal' }]),
    ).rejects.toThrow('permission denied')
  })
  it('discovers installed bundles including the user Applications directory', () => {
    mocks.existsSync.mockImplementation(
      (path) =>
        String(path).endsWith('/Applications/Tern.app') &&
        !String(path).startsWith('/Applications'),
    )
    expect(discoverTerminals().find((t) => t.name === 'Tern')?.installed).toBe(true)
    expect(discoverTerminals().find((t) => t.name === 'Warp')?.installed).toBe(false)
  })
})
