import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

import { app } from 'electron'
import WebSocket from 'ws'

import { cachedResolveAsyncPersistent } from './binaryCache.js'

/**
 * Minimal Codex app-server client for thread management. Prefers the shared app-server daemon
 * and falls back to a short-lived `codex app-server` over stdio when no daemon is running. Both
 * write Codex's own thread store. The Codex app runs its own embedded app-server and does not
 * pick up these external changes live; it shows them after it is reopened.
 */
type Transport = {
  send(message: unknown): void
  onMessage(handler: (message: Record<string, unknown>) => void): void
  close(): void
}

const TIMEOUT_MS = 20_000

function daemonSocket(): string | null {
  try {
    return realpathSync(join(homedir(), '.codex', 'app-server-control', 'app-server-control.sock'))
  } catch {
    return null
  }
}

function connectDaemon(socket: string): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws+unix://${socket}:/`)
    ws.once('open', () =>
      resolve({
        send: (message) => ws.send(JSON.stringify(message)),
        onMessage: (handler) => ws.on('message', (raw) => handler(JSON.parse(raw.toString()))),
        close: () => ws.close(),
      }),
    )
    ws.once('error', reject)
  })
}

async function spawnStdio(): Promise<Transport> {
  const bin = await cachedResolveAsyncPersistent('codex')
  if (!bin) throw new Error('The codex command was not found')
  const child = spawn(bin, ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] })
  const lines = createInterface({ input: child.stdout })
  return {
    send: (message) => child.stdin.write(`${JSON.stringify(message)}\n`),
    onMessage: (handler) =>
      lines.on('line', (line) => {
        try {
          handler(JSON.parse(line))
        } catch {
          /* ignore non-JSON output */
        }
      }),
    close: () => {
      lines.close()
      child.kill()
    },
  }
}

/** Run one app-server request (after the initialize handshake) and return its result. */
async function request(method: string, params: Record<string, unknown>): Promise<unknown> {
  const socket = daemonSocket()
  let transport: Transport
  try {
    transport = socket ? await connectDaemon(socket) : await spawnStdio()
  } catch {
    transport = await spawnStdio()
  }
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Codex ${method} timed out`)), TIMEOUT_MS)
      transport.onMessage((message) => {
        if (message.id === 1) {
          if (message.error)
            return reject(new Error(String((message.error as { message?: string }).message)))
          transport.send({ method: 'initialized' })
          transport.send({ id: 2, method, params })
        } else if (message.id === 2) {
          clearTimeout(timer)
          if (message.error)
            reject(new Error(String((message.error as { message?: string }).message)))
          else resolve(message.result)
        }
      })
      transport.send({
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'agenthub', title: 'AgentHub', version: app.getVersion() } },
      })
    })
  } finally {
    transport.close()
  }
}

export async function setCodexThreadName(threadId: string, name: string): Promise<void> {
  await request('thread/name/set', { threadId, name })
}

/** Remove a thread from Codex's catalog; its rollout files are already in the Trash. */
export async function deleteCodexThread(threadId: string): Promise<void> {
  await request('thread/delete', { threadId })
}
