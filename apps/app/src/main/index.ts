import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  nativeImage,
  net,
  shell,
} from 'electron'

// Install global error handlers as the very first thing in the file. Node 22
// defaults to --unhandled-rejections=strict, which means a single unhandled
// rejection — anywhere in this process or any worker_threads child — aborts
// the app with SIGTRAP (EXC_BREAKPOINT). Users see the macOS crash dialog
// with no actionable information. With these handlers attached, the process
// keeps running and we log enough context to diagnose later.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
  if (reason instanceof Error && reason.stack) console.error(reason.stack)
})
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err)
  if (err instanceof Error && err.stack) console.error(err.stack)
  try {
    // Don't exit — UI surfaces that already loaded should keep working.
    // The dialog is best-effort; if Electron itself isn't ready yet this
    // throws, and we just log.
    dialog.showErrorBox(
      'AgentHub ran into an unexpected error',
      `${err instanceof Error ? err.message : String(err)}\n\n` +
        `AgentHub will keep running, but if you see this repeatedly please restart the app.`,
    )
  } catch {
    /* dialog unavailable — log already happened */
  }
})

import {
  getDB,
  renameIndexedSession,
  sessionDeletionFiles,
  deleteSessionWithTranscripts,
  hermesSessionTarget,
  deleteHermesSession,
  renameHermesSession,
  renameCodexSession,
  type HermesSessionTarget,
  type HermesCliResult,
  SessionDeletionBlockedError,
  SessionDeletionPartialError,
  Syncer,
  SpoolWatcher,
  searchFragments,
  searchSessionPreview,
  listRecentSessionsPage,
  getSessionWithMessages,
  getStatus,
  pinSession,
  unpinSession,
  getPinnedUuids,
  listPinnedSessions,
  listProjectGroups,
  listSessionsByIdentity,
  listPinnedSessionsByIdentity,
  listProjectDirectoryCounts,
  listShareDrafts,
  getShareDraft,
  upsertShareDraft,
  deleteShareDraft,
  countDraftsBySession,
  invalidateSessionScanProfile,
  makeObservabilityRuntime,
  SPOOL_DIR,
} from '@spool-lab/core'
import type {
  FragmentResult,
  SessionSource,
  ListSessionsByIdentityOptions,
  SessionsCursor,
  ShareDraftRow,
  UpsertShareDraftInput,
} from '@spool-lab/core'
import { isSessionProvider } from '@spool-lab/session-kit'
import type Database from 'better-sqlite3'
import { Effect } from 'effect'

import { validateCustomTerminal } from '../shared/customTerminal.js'
import {
  applicationMenuTemplate,
  nativeDialogText,
  normalizeSystemLocale,
} from '../shared/nativeMenu.js'
import { getSessionResumeCommand } from '../shared/resumeCommand.js'
import { parseSessionLink, type SessionLinkResult } from '../shared/sessionLink.js'
import { getSessionSourceLabel } from '../shared/sessionSources.js'
import { AcpManager } from './acp.js'
import {
  dispatchDeepLink,
  dispatchDeepLinkFromArgv,
  registerDeepLinkScheme,
  onDeepLink,
} from './auth/deep-link.js'
import { cachedResolveAsyncPersistent, hydrateBinaryCache } from './binaryCache.js'
import { deleteCodexThread, setCodexThreadName } from './codexAppServer.js'
import { snapshotEventLoopLag, startEventLoopMonitor } from './eventLoopMonitor.js'
import { registerHubShareIpc } from './ipc/hub-share.js'
import {
  registerSecurityIpc,
  registerSecurityReadinessIpc,
  SECURITY_IPC_CHANNELS,
  type SecurityReadiness,
} from './ipc/security.js'
import { registerShareAuthIpc } from './ipc/share-auth.js'
import { registerShareProfileIpc } from './ipc/share-profile.js'
import { registerSharePublishIpc } from './ipc/share-publish.js'
import { spawnMutationWorker, type MutationWorkerProxy } from './mutation-worker-proxy.js'
import { spawnScanWorker, type ScanWorkerProxy } from './scan-worker-proxy.js'
import { installRendererCsp } from './security/csp.js'
import { pfModelDir } from './security/model-paths.js'
import { shouldAutoActivatePf } from './security/pf-activation.js'
import { makePfCoordinator } from './security/pf-coordinator.js'
import { registerPfModelProtocol, registerPfModelScheme } from './security/pf-model-protocol.js'
import { makePfRuntime, pfModelInstalled } from './security/pf-runtime.js'
import { loadSecurityPreferences, saveSecurityPreferences } from './securityPreferences.js'
import { resolveSessionMessage } from './sessionLink.js'
import { resolveResumeWorkingDirectory } from './sessionResume.js'
import type { SyncWorkerMessage } from './sync-worker.js'
import { openTerminal, discoverTerminals } from './terminal.js'
import { setupTray, updateTrayMenu } from './tray.js'
import {
  loadUIPreferences,
  saveThemeEditor,
  saveThemeSource,
  saveSidebarCollapsed,
} from './uiPreferences.js'
import { setupAutoUpdater, downloadUpdate, quitAndInstall } from './updater.js'

// Privilege the `pf-model://` scheme before app.ready so the hidden
// inference renderer can fetch model files through it. Has to happen
// here (module top-level) because protocol.registerSchemesAsPrivileged
// is a no-op once Electron has finished initialising.
registerPfModelScheme()

// Start the main-process event-loop lag monitor before any other module
// has a chance to do work. Cheap (a C++ histogram in node:perf_hooks).
// Exposed only when SPOOL_E2E_TEST=1, via a global the e2e harness can
// reach with `electronApp.evaluate(...)` — no production IPC surface.
startEventLoopMonitor()
if (process.env['SPOOL_E2E_TEST'] === '1') {
  ;(globalThis as { __spoolEventLoopLag?: typeof snapshotEventLoopLag }).__spoolEventLoopLag =
    snapshotEventLoopLag
}

const isDevMode = Boolean(process.env['ELECTRON_RENDERER_URL'])
const isMac = process.platform === 'darwin'
const customUserDataDir = process.env['SPOOL_ELECTRON_USER_DATA_DIR']?.trim()
if (customUserDataDir) {
  app.setPath('userData', customUserDataDir)
} else if (!isDevMode) {
  app.setPath('userData', join(app.getPath('appData'), 'AgentHub'))
}

const { run: runWithObservability } = makeObservabilityRuntime(
  isDevMode
    ? { serviceName: 'spool-app-main', serviceVersion: app.getVersion(), env: 'dev' }
    : {
        serviceName: 'spool-app-main',
        serviceVersion: app.getVersion(),
        env: 'prod',
        logsDir: join(SPOOL_DIR, 'logs'),
      },
)
// macOS menu bar shows the first menu's label as the app name
app.setName(isDevMode ? 'AgentHub DEV' : 'AgentHub')

const uiPreferences = loadUIPreferences()
nativeTheme.themeSource = uiPreferences.themeSource
let focusExistingWindow = () => {}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

// agenthub:// deep links (today: the WorkOS sign-in callback). macOS
// delivers via 'open-url'; Windows/Linux relaunch with the URL in argv,
// which the single-instance lock forwards through 'second-instance'.
registerDeepLinkScheme()
let sessionLinkRendererReady = false
const pendingSessionLinks: string[] = []
onDeepLink((url) => {
  if (url.hostname !== 'session') return false
  pendingSessionLinks.push(url.href)
  focusExistingWindow()
  flushSessionLinks()
  return true
})

function flushSessionLinks() {
  if (!sessionLinkRendererReady || !mainWindow || mainWindow.isDestroyed()) return
  while (pendingSessionLinks.length) {
    mainWindow.webContents.send('spool:open-session-link', pendingSessionLinks.shift())
  }
}

app.on('open-url', (event, url) => {
  event.preventDefault()
  dispatchDeepLink(url)
})

app.on('second-instance', (_event, argv) => {
  focusExistingWindow()
  dispatchDeepLinkFromArgv(argv)
})

let mainWindow: BrowserWindow | null = null
let db: Database.Database
let syncer: Syncer
let watcher: SpoolWatcher
let acpManager: AcpManager
let isSyncActive = false
let scanWorker: ScanWorkerProxy | null = null
let mutationWorker: MutationWorkerProxy | null = null
let disposeSecurityIpc: (() => void) | null = null
let setSecurityReadiness: ((next: SecurityReadiness) => void) | null = null
let disposeSecurityReadinessIpc: (() => void) | null = null
const pfRuntime = makePfRuntime({
  run: runWithObservability,
  // A post-handshake renderer crash leaves the ModelHost reporting
  // `ready` unless something flips it; the host now transitions to
  // `failed` on its own, but the scan worker only learns pf is offline
  // through this hook. Without it the worker keeps stamping `pf@...`
  // into scan_profile while every analyze round-trips to a dead window
  // and returns [] — a regex-only scan masquerading as ML coverage.
  onCrash: () => {
    console.error('[security] pf inference renderer crashed — taking scan worker offline')
    scanWorker?.notifyPfOffline()
  },
})
// Lazily resolved on first access — pfModelsRoot() reads app.getPath
// which throws before app.ready, but this module evaluates at boot.
let pfCoordinator: ReturnType<typeof makePfCoordinator> | null = null
// Whether the Security worker + IPC are currently up. Set by the
// idempotent ensureSecurityBooted.
let securityBooted = false
// The PF model URL-scheme handler is a process-lifetime singleton:
// registering it twice throws, so we only ever register once and leave
// it (it's passive when no inference window hits it).
let pfProtocolRegistered = false

type CachedSearchValue = FragmentResult[]

class SearchCache {
  private entries = new Map<string, { results: CachedSearchValue; expiresAt: number }>()

  get(key: string): CachedSearchValue | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt < Date.now()) {
      this.entries.delete(key)
      return undefined
    }
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.results
  }

  set(key: string, value: CachedSearchValue): void {
    if (value.length === 0) return
    this.entries.delete(key)
    this.entries.set(key, {
      results: value,
      expiresAt: Date.now() + 15000,
    })
    if (this.entries.size > 200) {
      const oldest = this.entries.keys().next().value
      if (oldest) this.entries.delete(oldest)
    }
  }

  clear(): void {
    this.entries.clear()
  }
}

const searchCache = new SearchCache()

async function bootScanWorker(): Promise<void> {
  try {
    // Engine lives in a worker thread so its synchronous SQL + regex
    // CPU work doesn't block the main-process event loop — keeping
    // window drag, foreground IPC, and renderer-driven queries
    // responsive even mid-backfill. WAL mode lets the main-process
    // read handle coexist with the worker's write handle.
    //
    // The pfBridge proxies the worker's pf-analyze-req messages
    // through pfRuntime.analyze → hidden inference window. When
    // pfRuntime isn't active, analyze() returns [] so the worker
    // gets an empty result quickly instead of blocking.
    scanWorker = await spawnScanWorker(join(__dirname, 'scan-worker-thread.mjs'), {
      analyze: (text) =>
        pfRuntime.analyze(text) as Promise<
          Array<{
            class: string
            value: string
            start: number
            end: number
            score: number
          }>
        >,
    })
  } catch (err) {
    console.error('[security] scan worker failed to boot:', err)
    scanWorker = null
  }
}

/** Bring up the mutation worker — purge / dismiss / undismiss SQL
 *  runs there so the main process event loop stays unblocked through
 *  the ~1s tail of bulk operations on large archives. Failure is
 *  non-fatal: the IPC handlers fall back to running the same SQL
 *  in-process on the main DB handle, which is the legacy behaviour. */
async function bootMutationWorker(): Promise<void> {
  try {
    mutationWorker = await spawnMutationWorker(join(__dirname, 'mutation-worker-thread.mjs'))
  } catch (err) {
    console.error('[security] mutation worker failed to boot:', err)
    mutationWorker = null
  }
}

async function shutdownScanWorker(): Promise<void> {
  if (disposeSecurityIpc) {
    try {
      disposeSecurityIpc()
    } catch {
      /* best effort */
    }
    disposeSecurityIpc = null
  }
  if (disposeSecurityReadinessIpc) {
    try {
      disposeSecurityReadinessIpc()
    } catch {
      /* best effort */
    }
    disposeSecurityReadinessIpc = null
    setSecurityReadiness = null
  }
  if (scanWorker) {
    try {
      await scanWorker.shutdown()
    } catch {
      /* best effort */
    }
    scanWorker = null
  }
  if (mutationWorker) {
    try {
      await mutationWorker.shutdown()
    } catch {
      /* best effort */
    }
    mutationWorker = null
  }
  try {
    await pfRuntime.stop()
  } catch {
    /* best effort */
  }
}

/** Idempotent boot of the Security feature: scan worker + its IPC, plus
 *  the process-lifetime PF protocol + coordinator (registered once).
 *  Called once at startup. */
async function ensureSecurityBooted(): Promise<void> {
  if (securityBooted) {
    console.log('[security.lifecycle] ensureSecurityBooted: already booted, skipping')
    return
  }
  securityBooted = true
  console.log('[security.lifecycle] booting — registering IPC + scan worker')

  const readiness = registerSecurityReadinessIpc(() => mainWindow)
  setSecurityReadiness = readiness.setReadiness
  disposeSecurityReadinessIpc = readiness.dispose

  if (!pfProtocolRegistered) {
    // Has to happen post-ready (uses protocol.handle + app.getPath).
    registerPfModelProtocol()
    pfProtocolRegistered = true
  }
  if (!pfCoordinator) {
    // Electron's `net.fetch` honours system proxy + custom CA bundle;
    // globalThis.fetch (undici) bypasses both (see bug_electron_proxy).
    // E2E exception: SPOOL_E2E_TEST swaps in an immediate-503 fake so the
    // download state machine is deterministic without a real network hop.
    const pfFetchImpl: typeof globalThis.fetch =
      process.env['SPOOL_E2E_TEST'] === '1'
        ? ((async () =>
            new Response(null, { status: 503, statusText: 'e2e-fake' })) as typeof globalThis.fetch)
        : (((url, init) => net.fetch(url as string, init)) as typeof globalThis.fetch)
    pfCoordinator = makePfCoordinator({
      modelDir: pfModelDir(),
      fetch: pfFetchImpl,
      run: runWithObservability,
    })
    // When a callout-initiated download completes, finish activation on
    // the user's behalf — flip pfEnabled so syncPfRuntime spawns the
    // inference window + kicks backfill.
    pfCoordinator.subscribe((s) => {
      if (s.phase !== 'installed') return
      const prefs = loadSecurityPreferences()
      // shouldAutoActivatePf gates on securityBooted so a download
      // that completes in the brief pre-boot window can't spawn a
      // hidden inference window before the feature is up.
      if (
        !shouldAutoActivatePf({
          phase: s.phase,
          securityBooted,
          pfActivationPending: prefs.pfActivationPending,
          pfEnabled: prefs.pfEnabled,
        })
      )
        return
      void (async () => {
        const next = saveSecurityPreferences({ pfEnabled: true })
        mainWindow?.webContents.send(SECURITY_IPC_CHANNELS.EVT_PREFS_CHANGED, next)
        await syncPfRuntime(true).catch((err) => {
          console.error('[security] callout-driven activation failed:', err)
        })
      })()
    })
  }

  await bootScanWorker()
  if (!scanWorker) {
    console.warn('[security.lifecycle] boot aborted — scanner unavailable')
    setSecurityReadiness?.({ ready: false, reason: 'scanner-unavailable' })
    return
  }
  // Register IPC immediately after the scan worker is ready so the
  // renderer's `security:get-scan-status` polling on first window
  // open finds a handler. Mutation-worker boot is deferred and
  // plumbed in via `securityIpc.attachMutationWorker` once it
  // reports ready — the handlers fall back to in-process SQL in the
  // meantime. Without this split the e2e harness saw the
  // first-window polling rejected with "No handler registered for
  // security:get-scan-status" because both worker boots were
  // awaited sequentially before the IPC was registered.
  const securityIpc = registerSecurityIpc({
    db,
    worker: scanWorker,
    runPromise: runWithObservability,
    getMainWindow: () => mainWindow,
    onSearchContentChanged: () => searchCache.clear(),
    pfCoordinator,
    pfRuntime,
    onPfEnabledChanged: (enabled) => {
      void syncPfRuntime(enabled).catch((err) => {
        console.error('[security] pf runtime transition failed:', err)
      })
    },
  })
  disposeSecurityIpc = securityIpc.dispose
  setSecurityReadiness?.({ ready: true })
  console.log('[security.lifecycle] booted — worker + IPC ready, backfilling')
  runWithObservability(scanWorker.backfill()).catch((err) => {
    console.error('[security] boot backfill failed:', err)
  })

  // Mutation worker boots in the background. Until it's ready the
  // IPC handlers run their in-process fallback path on the main
  // thread — same SQL, same correctness, just no off-main offload.
  // On success, attach so subsequent calls route through the worker
  // AND start the per-mutation change forwarder.
  void bootMutationWorker().then(() => {
    if (mutationWorker) {
      securityIpc.attachMutationWorker(mutationWorker)
    }
  })
  // If the user enabled PF before this boot, bring the inference window
  // up now that the rest of Spool is ready.
  if (loadSecurityPreferences().pfEnabled) {
    void syncPfRuntime(true).catch((err) => {
      console.error('[security] pf runtime boot failed:', err)
    })
  }
}

/** Bring the Privacy Filter inference window up or down to match the
 *  user's pfEnabled preference. Refuses to start the runtime if the
 *  ONNX weights aren't installed yet — flipping the toggle on while
 *  the download hasn't finished would just spawn a window with
 *  nothing to load. Tells the scan worker about the transition so its
 *  pfProvider.available() agrees with reality and `scan_profile`
 *  drifts (triggering a backfill rescan via worker.backfill()).
 *
 *  Also clears pfActivationPending on the way out — the callout's
 *  "Activating Privacy Filter…" state hangs on that flag, so it
 *  needs to drop the moment the runtime + backfill have settled
 *  (success or fail). The ScanBanner then takes over visually. */
async function syncPfRuntime(pfEnabled: boolean): Promise<void> {
  await runWithObservability(
    Effect.gen(function* () {
      yield* Effect.annotateCurrentSpan('pf.enabled', pfEnabled)
      if (pfEnabled && pfModelInstalled()) {
        yield* Effect.promise(() => pfRuntime.start())
        // pfRuntime.start() resolves even when the handshake failed —
        // the hidden window might be up but transformers.js / ONNX
        // crashed during model load. Check the actual runtime state
        // before telling the scan worker pf is online: otherwise
        // currentProfile drifts to `regex@1,pf@1.5b-q4.r2`, every analyze
        // round-trips to a dead host that returns [], and the user
        // sees regex-only findings tagged with a profile string that
        // lies about what scanned them.
        const state = yield* Effect.promise(() => pfRuntime.getState())
        yield* Effect.annotateCurrentSpan('pf.runtime.status', state?.status ?? 'null')
        if (state?.runtime) yield* Effect.annotateCurrentSpan('pf.runtime.kind', state.runtime)
        if (state?.error) yield* Effect.annotateCurrentSpan('pf.runtime.error', state.error)
        if (state?.status === 'ready') {
          yield* Effect.sync(() => scanWorker?.notifyPfOnline())
          yield* Effect.annotateCurrentSpan('pf.notified', 'online')
        } else {
          yield* Effect.logError(
            `[security] pf runtime failed to reach ready (status=${state?.status ?? 'unknown'}, error=${state?.error ?? 'unknown'})`,
          )
          yield* Effect.sync(() => scanWorker?.notifyPfOffline())
          yield* Effect.annotateCurrentSpan('pf.notified', 'offline')
        }
      } else {
        yield* Effect.sync(() => scanWorker?.notifyPfOffline())
        yield* Effect.promise(() => pfRuntime.stop())
      }
      if (scanWorker) {
        // User flipped the PF toggle (or completed the callout's
        // "Activate" flow) — mark this backfill as user-initiated so
        // the renderer shows a result banner on busy→idle, instead
        // of treating it as background work.
        yield* scanWorker.backfill({ userInitiated: true })
      }
    }).pipe(
      // pfActivationPending clears on the way out (success OR fail) so
      // the callout's "Activating…" state stops hanging on a permanent
      // failure. ScanBanner takes over visually once backfill enqueues.
      Effect.ensuring(
        Effect.sync(() => {
          const cur = loadSecurityPreferences()
          if (cur.pfActivationPending) {
            const next = saveSecurityPreferences({ pfActivationPending: false })
            mainWindow?.webContents.send(SECURITY_IPC_CHANNELS.EVT_PREFS_CHANGED, next)
          }
        }),
      ),
      Effect.withSpan('pf.sync_runtime'),
    ),
  )
}

function createWindow(): BrowserWindow {
  sessionLinkRendererReady = false
  const win = new BrowserWindow({
    title: isDevMode ? 'AgentHub DEV' : 'AgentHub',
    width: 1080,
    height: 740,
    minWidth: 800,
    minHeight: 520,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141410' : '#FAFAF8',
    autoHideMenuBar: !isMac,
    // hiddenInset keeps the traffic lights but lets the renderer paint
    // up to y=0, so the app's top bar sits flush with the close/min/max
    // buttons instead of stacking under a separate OS-rendered title bar.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (!isMac) {
    win.setMenuBarVisibility(false)
  }

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']).catch((error) => {
      console.error('[window] failed to load renderer URL:', error)
    })
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html')).catch((error) => {
      console.error('[window] failed to load renderer file:', error)
    })
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) || /^mailto:/i.test(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL()
    const isInternal =
      url === current ||
      url.startsWith('file://') ||
      (!!process.env['ELECTRON_RENDERER_URL'] &&
        url.startsWith(process.env['ELECTRON_RENDERER_URL']))
    if (isInternal) return
    if (/^https?:/i.test(url) || /^mailto:/i.test(url)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  win.webContents.on('did-start-loading', () => {
    sessionLinkRendererReady = false
  })
  win.on('closed', () => {
    mainWindow = null
    if (!isDevMode) app.dock?.hide()
  })

  return win
}

function openSettings(): void {
  focusExistingWindow()
  const contents = mainWindow?.webContents
  if (!contents) return
  if (contents.isLoadingMainFrame()) {
    contents.once('did-finish-load', () => contents.send('spool:open-settings'))
  } else {
    contents.send('spool:open-settings')
  }
}

function buildApplicationMenu(): Menu {
  return Menu.buildFromTemplate(
    applicationMenuTemplate(
      acpManager.getAgentsConfig().language,
      app.getLocale(),
      isMac,
      openSettings,
    ),
  )
}
let activeSyncPromise: Promise<{ added: number; updated: number; errors: number }> | null = null

function runSyncWorker(): Promise<{ added: number; updated: number; errors: number }> {
  if (deletingSession) return Promise.reject(new Error('删除会话期间无法同步，请稍后重试'))
  if (activeSyncPromise) return activeSyncPromise

  activeSyncPromise = new Promise<{ added: number; updated: number; errors: number }>(
    (resolve, reject) => {
      const workerPath = join(__dirname, 'sync-worker.mjs')
      const worker = new Worker(workerPath)
      worker.on('message', (msg: SyncWorkerMessage) => {
        if (msg.type === 'progress') {
          isSyncActive = msg.data.phase !== 'done'
          searchCache.clear()
          mainWindow?.webContents.send('spool:sync-progress', msg.data)
        } else if (msg.type === 'done') {
          isSyncActive = false
          searchCache.clear()
          resolve(msg.result)
        } else if (msg.type === 'error') {
          isSyncActive = false
          reject(new Error(msg.error))
        }
      })
      worker.on('error', reject)
      worker.on('exit', (code) => {
        if (code !== 0) reject(new Error(`Sync worker exited with code ${code}`))
      })
    },
  ).finally(() => {
    activeSyncPromise = null
  })

  return activeSyncPromise
}

app
  .whenReady()
  .then(async () => {
    // Renderer CSP — has to land BEFORE any BrowserWindow loads its URL,
    // otherwise the first response slips through with whatever Vite (or
    // the bundled file:// loader) emits and Electron's "Insecure CSP"
    // warning fires once before our header takes over.
    installRendererCsp({ dev: isDevMode })

    // Hydrate the agent-binary path cache from disk before anything has a
    // chance to call `cachedResolveAsync`. Without this every cold launch
    // re-runs `<user-shell> -ilc 'command -v ...'` once per agent — three
    // serialised execSync-style spawns on a slow .zshrc are the dominant
    // contributor to the launch beachball.
    hydrateBinaryCache()

    // Set dock icon (dev mode doesn't pick up build config)
    const dockIconPath = join(__dirname, '../../resources/icon.icns')
    try {
      app.dock?.setIcon(nativeImage.createFromPath(dockIconPath))
    } catch {}

    db = getDB()
    acpManager = new AcpManager()
    Menu.setApplicationMenu(buildApplicationMenu())

    syncer = new Syncer(db, undefined, (sessionId) => {
      // Sync mutated this session's messages; existing findings now have
      // stale offsets. The Syncer already nulled scan_profile inside the
      // commit txn; here we just re-enqueue so the worker picks it up —
      // unless the user opted out of auto-rescan in Settings → Security,
      // in which case we leave scan_profile dirty for the next manual
      // Rescan all click.
      // `invalidateSessionScanProfile` updates the v12 `scan_profile`
      // column regardless of the feature flag — the column lives in
      // every user's schema. Re-enqueuing only runs when the worker
      // is booted (i.e. the flag is on); the column resets either
      // way, which keeps state consistent if the flag flips on later.
      invalidateSessionScanProfile(db, sessionId)
      if (scanWorker && loadSecurityPreferences().rescanAfterSync === 'auto') {
        // Promise-shaped so a worker-thread rejection (e.g. the child
        // died) surfaces in the log instead of vanishing silently
        // through Effect.runFork. The Effect itself is failure-free
        // shape (Effect<void, never>) — `.catch` here is the safety
        // net for runtime promise rejections from the underlying
        // postMessage round-trip.
        runWithObservability(scanWorker.enqueue(sessionId)).catch((err) => {
          console.error('[security] scan-worker enqueue failed:', err)
        })
      }
    })
    watcher = new SpoolWatcher(syncer)
    watcher.on('new-sessions', (_event, data) => {
      searchCache.clear()
      mainWindow?.webContents.send('spool:new-sessions', data)
    })
    watcher.on('error', (_event, data) => {
      console.error('[watcher]', data.error, data.root ? `(root=${data.root})` : '')
    })

    // Initial sync in worker thread (non-blocking)
    runSyncWorker()
      .then((result) => {
        watcher.start()
        // Sessions were inserted by the worker thread which has its own
        // DB handle, so the renderer never got an onNewSessions push for
        // them. Without an explicit signal here, any view that listed
        // sessions BEFORE sync finished would stay empty until the next
        // file-watcher event. Emit new-sessions so LibraryLanding /
        // ProjectView refetch — same code path that already handles
        // post-startup inserts.
        if (result.added > 0) {
          mainWindow?.webContents.send('spool:new-sessions', { count: result.added })
        }
        // Sessions were inserted by the worker thread which has its own DB
        // handle — no onSessionChanged callbacks reached this process. Kick
        // off a backfill round now that the sessions table is populated.
        if (scanWorker) {
          runWithObservability(scanWorker.backfill()).catch((err) => {
            console.error('[security] post-sync backfill failed:', err)
          })
        }
      })
      .catch((err) => {
        console.error('[sync-worker] failed:', err)
      })

    mainWindow = createWindow()

    // Boot the Security Scan worker AFTER createWindow so the renderer
    // mount + initial sync don't wait on it. The Syncer's
    // onSessionChanged callback and the post-sync backfill are both
    // guarded by `if (scanWorker)`, so any session changes that fire
    // before the worker is ready are no-ops — backfill catches up once
    // boot completes.
    void ensureSecurityBooted()

    // Share-auth IPC (PKCE loopback OAuth + safeStorage session).
    // The build-time __SPOOL_E2E__ switch is the ONE place the production
    // binary chooses between real OAuth + safeStorage and the e2e-mode
    // in-memory store + fake-id-token. Prod builds get
    // `if (false) { ... }` here, which terser deletes outright; the
    // dynamic import to ./e2e-mode/share-auth-e2e is never resolved by
    // rollup, so its source never ships in any production bundle.
    if (__SPOOL_E2E__) {
      const { registerShareAuthIpcForE2E } = await import('./e2e-mode/share-auth-e2e.js')
      registerShareAuthIpcForE2E()
    } else {
      registerShareAuthIpc()
    }
    // Share-publish IPC (publish / revoke / republish + handles)
    registerSharePublishIpc()
    // Share-profile IPC (display name + avatar upload / delete / visibility)
    registerShareProfileIpc()
    // v2 hub share IPC (one-click records share to spool.pro)
    registerHubShareIpc()

    // Auto-updater (only runs in packaged builds)
    setupAutoUpdater(() => mainWindow)

    function showOrCreateWindow() {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      } else {
        mainWindow = createWindow()
      }
      void app.dock?.show()
    }
    focusExistingWindow = showOrCreateWindow
    dispatchDeepLinkFromArgv(process.argv)
    if (pendingSessionLinks.length) showOrCreateWindow()
    flushSessionLinks()

    if (!isDevMode) {
      setupTray(
        showOrCreateWindow,
        () => {
          void runSyncWorker().catch((error) => {
            console.error('[sync-worker] tray sync failed:', error)
          })
        },
        openSettings,
        () => acpManager.getAgentsConfig().language,
      )
    }

    app.on('activate', showOrCreateWindow)
  })
  .catch((err) => {
    // Without this catch, any rejection from the startup sequence becomes an
    // unhandled promise rejection — Node 20+ terminates the process with SIGTRAP,
    // producing an opaque EXC_BREAKPOINT crash with only `PromiseRejectCallback`
    // in the stack. Logging the error here gives users something actionable.
    console.error('[startup] fatal error during app initialization:', err)
    if (err instanceof Error && err.stack) console.error(err.stack)
    dialog.showErrorBox(
      'AgentHub failed to start',
      err instanceof Error ? err.message : String(err),
    )
    app.exit(1)
  })

app.on('window-all-closed', () => {
  if (isDevMode) {
    app.quit()
    return
  }
  // On macOS, keep app running in tray
  app.dock?.hide()
})

app.on('before-quit', (event) => {
  // Tear down the scan worker thread before Electron releases the
  // database — the thread holds its own DB handle and needs a clean
  // Scope.close to drop it.
  if (scanWorker) {
    event.preventDefault()
    shutdownScanWorker()
      .catch((err) => {
        console.error('[security] shutdown failed:', err)
      })
      .finally(() => {
        app.exit(0)
      })
  }
})

// ── IPC Handlers ──────────────────────────────────────────────────────────────

ipcMain.handle(
  'spool:search',
  (
    _e,
    {
      query,
      limit = 10,
      source,
      onlyPinned,
      identityKey,
    }: {
      query: string
      limit?: number
      source?: string
      onlyPinned?: boolean
      identityKey?: string
    },
  ) => {
    const cacheKey = `${source ?? 'all'}|${identityKey ?? 'any'}|${limit}|${onlyPinned ? 'pinned' : 'full'}|${query}`
    if (!isSyncActive) {
      const cached = searchCache.get(cacheKey)
      if (cached) return cached
    }

    const sessionSource = source !== undefined && isSessionProvider(source) ? source : undefined
    const results = searchFragments(db, query, {
      limit,
      ...(sessionSource ? { source: sessionSource } : {}),
      ...(onlyPinned ? { onlyPinned: true } : {}),
      ...(identityKey ? { identityKey } : {}),
    }).map((f) => ({ ...f, kind: 'fragment' as const }))

    if (!isSyncActive) {
      searchCache.set(cacheKey, results)
    }

    return results
  },
)

ipcMain.handle(
  'spool:search-preview',
  (_e, { query, limit = 5, source }: { query: string; limit?: number; source?: string }) => {
    const cacheKey = `preview|${source ?? 'all'}|${limit}|${query}`
    const cached = searchCache.get(cacheKey)
    if (cached) return cached

    const sessionSource = source !== undefined && isSessionProvider(source) ? source : undefined
    const fragments = searchSessionPreview(db, query, {
      limit,
      ...(sessionSource ? { source: sessionSource } : {}),
    }).map((f) => ({ ...f, kind: 'fragment' as const }))
    searchCache.set(cacheKey, fragments)
    return fragments
  },
)

ipcMain.handle('spool:list-sessions', (_e, args: ListSessionsByIdentityOptions = {}) => {
  return listRecentSessionsPage(db, args)
})

ipcMain.handle('spool:list-project-groups', () => {
  return listProjectGroups(db)
})

ipcMain.handle(
  'spool:list-sessions-by-identity',
  (
    _e,
    { identityKey, options }: { identityKey: string; options?: ListSessionsByIdentityOptions },
  ) => {
    return listSessionsByIdentity(db, identityKey, options)
  },
)

ipcMain.handle(
  'spool:list-project-directory-counts',
  (_e, { identityKey, sources }: { identityKey: string; sources?: SessionSource[] }) => {
    return listProjectDirectoryCounts(db, identityKey, sources ? { sources } : {})
  },
)

ipcMain.handle('spool:get-session', (_e, { sessionUuid }: { sessionUuid: string }) => {
  return getSessionWithMessages(db, sessionUuid, { includeInternal: true })
})

ipcMain.handle('spool:session-links-ready', (event) => {
  if (event.sender !== mainWindow?.webContents) throw new Error('Invalid session link sender')
  sessionLinkRendererReady = true
  flushSessionLinks()
})

ipcMain.handle('spool:resolve-session-link', (event, raw: unknown): SessionLinkResult => {
  try {
    if (event.sender !== mainWindow?.webContents || typeof raw !== 'string')
      throw new Error('会话链接请求无效。')
    const link = parseSessionLink(raw)
    const selected = getSessionWithMessages(db, link.sessionUuid, { includeInternal: true })
    if (!selected) throw new Error('找不到此会话，请先同步 AgentHub。')
    if (!existsSync(selected.session.filePath) && !existsSync(`${selected.session.filePath}.zst`))
      throw new Error('原始会话记录已删除或不可访问，无法打开此链接。')
    const messageId = resolveSessionMessage(raw, selected.messages)
    return {
      ok: true,
      sessionUuid: link.sessionUuid,
      ...(messageId === undefined ? {} : { messageId }),
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle(
  'spool:rename-session',
  async (_e, { uuid, title }: { uuid: string; title: string }) => {
    try {
      // Hermes titles live in its own store: write through its CLI so Hermes shows the same name.
      const source = (
        db
          .prepare(
            'SELECT src.name AS source FROM sessions s JOIN sources src ON src.id = s.source_id WHERE s.session_uuid = ?',
          )
          .get(uuid) as { source: string } | undefined
      )?.source
      const saved =
        source === 'hermes'
          ? await renameHermesSession(db, uuid, title, runHermesRename)
          : source === 'codex'
            ? await renameCodexSession(db, uuid, title, setCodexThreadName)
            : (renameIndexedSession(db, uuid, title), title.trim())
      searchCache.clear()
      mainWindow?.webContents.send('spool:new-sessions', { count: 0 })
      return { ok: true, title: saved }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  },
)

/** Run a `hermes sessions …` command against the Hermes home that owns the indexed store. */
async function runHermesSessions(
  target: HermesSessionTarget,
  args: string[],
): Promise<HermesCliResult> {
  const bin = await cachedResolveAsyncPersistent('hermes')
  if (!bin)
    throw new SessionDeletionBlockedError('agent-unavailable', 'The hermes command was not found', {
      source: 'hermes',
    })
  return new Promise((resolve) => {
    execFile(
      bin,
      ['sessions', ...args],
      {
        env: { ...process.env, HERMES_HOME: target.hermesHome },
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : null) : 0
        resolve({
          code,
          output: [stdout, stderr, error && !stdout && !stderr ? error.message : '']
            .filter(Boolean)
            .join('\n'),
        })
      },
    )
  })
}

const runHermesDelete = (target: HermesSessionTarget) =>
  runHermesSessions(target, ['delete', '--yes', target.sessionId])
const runHermesRename = (target: HermesSessionTarget, title: string) =>
  runHermesSessions(target, ['rename', target.sessionId, title])

let deletingSession = false
ipcMain.handle('spool:delete-session', async (_e, { uuid }: { uuid: string }) => {
  if (!mainWindow) throw new Error('Application window is unavailable')
  const window = mainWindow
  const text = nativeDialogText(acpManager.getAgentsConfig().language, app.getLocale())
  const explain = (title: string, detail: string, type: 'warning' | 'error' = 'warning') =>
    dialog.showMessageBox(window, {
      type,
      message: title,
      detail,
      buttons: [text('ok')],
      noLink: true,
    })
  if (deletingSession) {
    await explain(text('blockedTitle'), text('busy'))
    return { deleted: false }
  }
  deletingSession = true
  let watcherPaused = false
  try {
    if (activeSyncPromise) await activeSyncPromise
    const session = getSessionWithMessages(db, uuid)?.session
    if (!session) throw new Error('Session not found')
    const source = getSessionSourceLabel(session.source)
    if (session.source === 'hermes') {
      // Hermes keeps sessions in a shared SQLite store: delete through its own CLI, permanently.
      const target = hermesSessionTarget(db, uuid)
      const confirmation = await dialog.showMessageBox(window, {
        type: 'warning',
        message: text('deleteTitle', { title: session.title ?? uuid }),
        detail: `${text('hermesDeleteDetail')}\n\n${target.databasePath}\n${target.sessionId}`,
        buttons: [text('cancel'), text('deletePermanent')],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      if (confirmation.response !== 1) return { deleted: false }
      watcher.stop()
      watcherPaused = true
      await deleteHermesSession(db, uuid, runHermesDelete)
      searchCache.clear()
      window.webContents.send('spool:new-sessions', { count: 0 })
      return { deleted: true }
    }
    const paths = sessionDeletionFiles(db, uuid)
    const confirmation = await dialog.showMessageBox(window, {
      type: 'warning',
      message: text('deleteTitle', { title: session.title ?? uuid }),
      detail: `${text('deleteDetail', { source })}${session.source === 'codex' ? `\n${text('codexDeleteNote')}` : ''}\n\n${paths.join('\n') || text('deleteNoFiles')}`,
      buttons: [text('cancel'), text('deleteConfirm')],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    if (confirmation.response !== 1) return { deleted: false }
    watcher.stop()
    watcherPaused = true
    const currentPaths = sessionDeletionFiles(db, uuid)
    if (currentPaths.join('\n') !== paths.join('\n')) {
      await explain(text('blockedTitle'), text('filesChanged'))
      return { deleted: false }
    }
    await deleteSessionWithTranscripts(db, uuid, paths, (path) => shell.trashItem(path))
    if (session.source === 'codex') {
      // Files are in the Trash; also drop the thread from Codex's own list so the Codex app agrees.
      try {
        await deleteCodexThread(uuid)
      } catch (error) {
        await explain(
          text('failedTitle'),
          `${text('codexListNotCleared')}\n\n${error instanceof Error ? error.message : String(error)}`,
          'error',
        )
      }
    }
    searchCache.clear()
    window.webContents.send('spool:new-sessions', { count: 0 })
    return { deleted: true }
  } catch (error) {
    // Explain refusals and failures in a modal the user can't miss, in the app language.
    if (error instanceof SessionDeletionBlockedError) {
      const source = getSessionSourceLabel(error.detail.source ?? '')
      const detail = {
        running: () =>
          error.detail.source === 'hermes'
            ? `${text('hermesRunning')}\n\n${error.detail.output ?? ''}`.trim()
            : text('running', { pid: error.detail.pid ?? '?' }),
        unsupported: () => text('unsupported', { source }),
        'agent-unavailable': () => text('agentUnavailable', { source }),
        'shared-database': () => text('sharedDatabase'),
        'root-unavailable': () => text('rootUnavailable'),
        'unsafe-path': () => `${text('unsafePath')}\n\n${error.message}`,
      }[error.reason]()
      await explain(text('blockedTitle'), detail)
    } else if (error instanceof SessionDeletionPartialError) {
      await explain(
        text('failedTitle'),
        `${text('partial', { moved: error.moved })}\n\n${String(error.cause)}`,
        'error',
      )
    } else {
      await explain(
        text('failedTitle'),
        error instanceof Error ? error.message : String(error),
        'error',
      )
    }
    return { deleted: false }
  } finally {
    deletingSession = false
    if (watcherPaused) watcher.start()
  }
})

ipcMain.handle('spool:get-status', () => {
  return getStatus(db)
})

ipcMain.handle('spool:pin-session', (_e, { uuid }: { uuid: string }) => {
  pinSession(db, uuid)
  searchCache.clear()
  return { ok: true }
})

ipcMain.handle('spool:unpin-session', (_e, { uuid }: { uuid: string }) => {
  unpinSession(db, uuid)
  searchCache.clear()
  return { ok: true }
})

ipcMain.handle('spool:get-pinned-uuids', () => {
  return getPinnedUuids(db)
})

ipcMain.handle('spool:list-pinned-sessions', () => {
  return listPinnedSessions(db)
})

ipcMain.handle(
  'spool:list-pinned-sessions-by-identity',
  (_e, { identityKey }: { identityKey: string }) => {
    return listPinnedSessionsByIdentity(db, identityKey)
  },
)

ipcMain.handle('spool:list-share-drafts', (_e, { limit }: { limit?: number } = {}) => {
  const opts: { limit?: number } = {}
  if (limit !== undefined) opts.limit = limit
  return listShareDrafts(db, opts)
})

ipcMain.handle('spool:get-share-draft', (_e, { draftId }: { draftId: string }) => {
  return getShareDraft(db, draftId)
})

ipcMain.handle('spool:upsert-share-draft', (_e, { input }: { input: UpsertShareDraftInput }) => {
  upsertShareDraft(db, input)
  return { ok: true }
})

ipcMain.handle('spool:delete-share-draft', (_e, { draftId }: { draftId: string }) => {
  deleteShareDraft(db, draftId)
  return { ok: true }
})

ipcMain.handle('spool:count-drafts-by-session', (_e, { sessionUuid }: { sessionUuid: string }) => {
  return countDraftsBySession(db, sessionUuid)
})

ipcMain.handle('spool:get-runtime-info', () => {
  return {
    isDev: isDevMode,
    appPath: app.getAppPath(),
    appName: app.getName(),
  }
})

ipcMain.handle('spool:get-system-locale', () => normalizeSystemLocale(app.getLocale()))

ipcMain.handle('spool:sync-now', () => {
  return runSyncWorker()
})

/**
 * Explicit "Refresh from source" — rebuilds a single session by
 * bypassing the watcher's mtime-skip and the syncer's classifySync
 * heuristic. This is the escape hatch for the rare cases append-only
 * sync deliberately can't auto-detect:
 *
 *   - The user manually edited the jsonl on disk (rare but real).
 *   - A provider updated an existing message in-place without
 *     bumping mtime in a way the watcher noticed.
 *   - The session's DB rows have drifted from the source for any
 *     other reason and the user wants to start over from source.
 *
 * Cost the user is accepting by triggering this: every finding row
 * tied to the session's messages is cascade-deleted by the DELETE
 * FROM messages step. Active findings are re-detected on the next
 * scan; allowlist entries survive (different table, not cascaded);
 * but per-finding state the user set explicitly — `state = 'purged'`
 * is the one that hurts — is gone. The renderer warns about this
 * before calling.
 */
ipcMain.handle('spool:force-resync-session', (_e, { sessionUuid }: { sessionUuid: string }) => {
  if (!syncer) return { ok: false as const, error: 'syncer-not-ready' }
  const row = db
    .prepare('SELECT file_path, source_id FROM sessions WHERE session_uuid = ?')
    .get(sessionUuid) as { file_path: string; source_id: number } | undefined
  if (!row) return { ok: false as const, error: 'session-not-found' }
  const sourceRow = db.prepare('SELECT name FROM sources WHERE id = ?').get(row.source_id) as
    | { name: SessionSource }
    | undefined
  if (!sourceRow) return { ok: false as const, error: 'source-not-found' }
  try {
    const result = syncer.syncFile(row.file_path, sourceRow.name, undefined, undefined, {
      forceMode: 'rewrite',
    })
    if (result === 'error') return { ok: false as const, error: 'sync-error' }
    return { ok: true as const, result }
  } catch (err) {
    console.error('[spool:force-resync-session]', err)
    return { ok: false as const, error: String(err) }
  }
})

ipcMain.handle(
  'spool:resume-cli',
  async (
    _e,
    { sessionUuid, source, cwd }: { sessionUuid: string; source: string; cwd?: string },
  ) => {
    try {
      const command = getSessionResumeCommand(source, sessionUuid)
      if (!command) {
        return { ok: false, error: `Session source "${source}" cannot be resumed from the CLI.` }
      }
      const session = getSessionWithMessages(db, sessionUuid)?.session
      const resumeCwd = session
        ? resolveResumeWorkingDirectory(session)
        : resolveResumeWorkingDirectory({
            source: source as SessionSource,
            cwd: cwd ?? null,
            projectDisplayPath: '',
            filePath: '',
          })
      const terminal = acpManager.getAgentsConfig().terminal
      await openTerminal(command, terminal, resumeCwd, acpManager.getAgentsConfig().customTerminals)
      return { ok: true }
    } catch (err) {
      console.error('[spool:resume-cli]', err)
      return { ok: false, error: String(err) }
    }
  },
)

ipcMain.handle('spool:copy-fragment', (_e, { text }: { text: string }) => {
  const { clipboard } = require('electron')
  clipboard.writeText(text)
  return { ok: true }
})

ipcMain.handle('spool:get-theme', () => {
  return nativeTheme.themeSource
})

ipcMain.handle('spool:set-theme', (_e, { theme }: { theme: 'system' | 'light' | 'dark' }) => {
  uiPreferences.themeSource = theme
  nativeTheme.themeSource = theme
  saveThemeSource(theme)
  return { ok: true }
})

ipcMain.handle('spool:get-theme-editor-state', () => {
  return uiPreferences.themeEditor
})

ipcMain.handle(
  'spool:set-theme-editor-state',
  (_e, { state }: { state: import('../renderer/theme/editorTypes.js').ThemeEditorStateV1 }) => {
    uiPreferences.themeEditor = state
    saveThemeEditor(state)
    return { ok: true }
  },
)

// ── AI / ACP Handlers ────────────────────────────────────────────────────────

ipcMain.handle('spool:ai-agents', () => {
  return acpManager.detectAgents()
})

ipcMain.handle('spool:ai-builtin-agents', () => {
  return acpManager.getBuiltinAgents()
})

ipcMain.handle('spool:ai-get-config', () => {
  return acpManager.getAgentsConfig()
})

ipcMain.handle('spool:terminals-discover', () => discoverTerminals())
ipcMain.handle('spool:terminal-pick', async () => {
  const text = nativeDialogText(acpManager.getAgentsConfig().language, app.getLocale())
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    title: text('chooseTerminal'),
  })
  return result.canceled ? null : (result.filePaths[0] ?? null)
})
ipcMain.handle('spool:terminal-test', async () => {
  const config = acpManager.getAgentsConfig()
  await openTerminal(
    "printf '%s\\n' 'AgentHub terminal test OK'",
    config.terminal,
    undefined,
    config.customTerminals,
  )
})

ipcMain.handle(
  'spool:ai-set-config',
  (_e, { config }: { config: import('./acp.js').AgentsConfig }) => {
    for (const terminal of config.customTerminals ?? []) validateCustomTerminal(terminal)
    acpManager.saveAgentsConfig(config)
    Menu.setApplicationMenu(buildApplicationMenu())
    updateTrayMenu()
    return { ok: true }
  },
)

ipcMain.handle(
  'spool:ai-search',
  async (
    _e,
    {
      query,
      agentId,
      context,
    }: { query: string; agentId: string; context: import('@spool-lab/core').FragmentResult[] },
  ) => {
    try {
      const fullText = await acpManager.query(
        agentId,
        query,
        context,
        (text) => {
          mainWindow?.webContents.send('spool:ai-chunk', { text })
        },
        (toolCall) => {
          mainWindow?.webContents.send('spool:ai-tool-call', toolCall)
        },
        (info) => {
          mainWindow?.webContents.send('spool:ai-session-started', info)
        },
      )
      mainWindow?.webContents.send('spool:ai-done', { fullText })
      return { ok: true, fullText }
    } catch (err) {
      const error =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as any).message)
            : String(err)
      console.error('[spool:ai-search] Agent query failed:', error)
      if (err instanceof Error && err.stack) console.error(err.stack)
      mainWindow?.webContents.send('spool:ai-done', { fullText: '', error })
      return { ok: false, error }
    }
  },
)

ipcMain.handle(
  'spool:ai-summarize-session',
  async (_e, { sessionUuid, agentId }: { sessionUuid: string; agentId: string }) => {
    try {
      const selected = getSessionWithMessages(db, sessionUuid)
      if (!selected) return { ok: false, error: 'Session not found.' }

      const summary = (
        await acpManager.summarizeSession(agentId, selected.session, selected.messages)
      ).trim()
      if (!summary) return { ok: false, error: 'Your agent returned an empty summary.' }
      return { ok: true, summary }
    } catch (err) {
      const error =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : String(err)
      console.error('[spool:ai-summarize-session] Agent summary failed:', error)
      return { ok: false, error }
    }
  },
)

ipcMain.handle('spool:ai-cancel', () => {
  acpManager.cancel()
  return { ok: true }
})

ipcMain.handle('spool:get-sidebar-collapsed', (): boolean => {
  return uiPreferences.sidebarCollapsed
})

ipcMain.handle('spool:set-sidebar-collapsed', (_e, { collapsed }: { collapsed: boolean }) => {
  uiPreferences.sidebarCollapsed = collapsed
  saveSidebarCollapsed(collapsed)
  return { ok: true }
})

// ── Auto-update ──────────────────────────────────────────────────────────

ipcMain.handle('spool:download-update', () => {
  downloadUpdate()
})

ipcMain.handle('spool:install-update', () => {
  quitAndInstall()
})

// Share editor PDF export — render the artifact in a hidden
// BrowserWindow that contains ONLY the cloned target element, then
// printToPDF that window. Targeting an isolated window (instead of
// trying to scope the main renderer with @media print rules) sidesteps
// all the CSS/layout interference that comes from sharing a page with
// the rest of the Spool app — body width, Tailwind utilities, React
// portals, the works. The hidden window loads the same renderer URL
// (so the same CSS bundle is available), then swaps its body for the
// caller-supplied HTML, waits for fonts, and prints.
// A4 page width @ 96dpi. We reflow the cloned artifact to this width
// so it fills the page edge-to-edge (no left/right gutter), then
// printToPDF at A4 — Chromium paginates vertically as content runs.
const A4_PAGE_WIDTH_PX = 794
ipcMain.handle(
  'spool:print-to-pdf',
  async (e, args: { html: string; widthPx: number; heightPx: number }): Promise<Uint8Array> => {
    const callerUrl = e.sender.getURL()
    const printWin = new BrowserWindow({
      show: false,
      width: A4_PAGE_WIDTH_PX,
      height: 1123,
      useContentSize: true,
      // Keep the OS sandbox on: the injected artifact HTML is
      // renderer-supplied and can carry hostile inline handlers /
      // embeds. printToPDF, executeJavaScript and document.fonts all
      // work sandboxed, and this window needs no Node/preload.
      webPreferences: { sandbox: true, offscreen: true },
    })
    // The window only ever renders the caller's artifact for one
    // printToPDF pass — deny any popup or navigation so a malicious
    // href/embed in that HTML can't drive it off the loaded page.
    printWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    printWin.webContents.on('will-navigate', (event, url) => {
      if (url !== callerUrl) event.preventDefault()
    })
    try {
      await printWin.loadURL(callerUrl)
      await printWin.webContents.executeJavaScript(`(async () => {
        document.body.innerHTML = ${JSON.stringify(args.html)}
        document.body.style.cssText = 'margin:0;padding:0;background:white;width:${A4_PAGE_WIDTH_PX}px;overflow:visible;height:auto;'
        document.documentElement.style.cssText = 'margin:0;padding:0;background:white;width:${A4_PAGE_WIDTH_PX}px;overflow:visible;height:auto;'
        const artifact = document.body.firstElementChild
        if (artifact) {
          artifact.style.width = '${A4_PAGE_WIDTH_PX}px'
          artifact.style.maxWidth = '${A4_PAGE_WIDTH_PX}px'
        }
        await document.fonts.ready
      })()`)
      const buf = await printWin.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 },
      })
      return new Uint8Array(buf)
    } finally {
      printWin.destroy()
    }
  },
)
