import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Launch the Spool Electron app pre-seeded with a programmatic project list
 * for release-video captures. Separate from `launchApp()` in `launch.ts`,
 * which uses the static test fixtures.
 */
import { _electron as electron, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

import { buildDemoFixtures, type ProjectSeed, type BuildDemoFixturesOptions } from './demo-fixtures'

const APP_DIR = join(__dirname, '..', '..')

export interface AppContext {
  app: ElectronApplication
  window: Page
  tmpDir: string
  cleanup: () => Promise<void>
}

export interface LaunchDemoOptions {
  /** Shallow JSON written to `agents.json` in SPOOL_HOME *before* Electron
   *  boots. Use this to seed config the main process reads from the
   *  file at startup — e.g. a default agent or feature opt-in. Stays
   *  feature-agnostic so future flags drop in without changing this
   *  signature. */
  agentsConfig?: Record<string, unknown>
}

/**
 * Build demo fixtures under a fresh tmpdir and launch Electron pointing at
 * them. Forces dark mode and disables GPU for deterministic frames.
 */
export async function launchDemoApp(
  projects: ProjectSeed[],
  fixtureOptions: BuildDemoFixturesOptions = {},
  launchOptions: LaunchDemoOptions = {},
): Promise<AppContext> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'spool-demo-capture-'))
  buildDemoFixtures(tmpDir, projects, fixtureOptions)

  if (launchOptions.agentsConfig) {
    const spoolHome = join(tmpDir, 'spool-home')
    mkdirSync(spoolHome, { recursive: true })
    writeFileSync(
      join(spoolHome, 'agents.json'),
      JSON.stringify(launchOptions.agentsConfig),
      'utf8',
    )
  }

  // Isolate every supported agent. buildDemoFixtures seeds only Claude/Codex/
  // Gemini, so the rest point at empty dirs — otherwise a capture falls back to
  // the machine's real session data (privacy leak into public screenshots).
  const otherAgents = ['cursor', 'dsh', 'hermes', 'openclaw', 'opencode', 'pi', 'workbuddy']
  for (const name of otherAgents) mkdirSync(join(tmpDir, name), { recursive: true })

  const agentEnv: Record<string, string> = {
    SPOOL_CURSOR_DIR: join(tmpDir, 'cursor'),
    SPOOL_CURSOR_STATE_DB: join(tmpDir, 'cursor', 'state.vscdb'),
    CURSOR_DATA_DIR: join(tmpDir, 'cursor'),
    SPOOL_DSH_DIR: join(tmpDir, 'dsh'),
    DSH_HOME: join(tmpDir, 'dsh'),
    SPOOL_HERMES_DIR: join(tmpDir, 'hermes'),
    HERMES_HOME: join(tmpDir, 'hermes'),
    SPOOL_OPENCLAW_DIR: join(tmpDir, 'openclaw'),
    OPENCLAW_STATE_DIR: join(tmpDir, 'openclaw'),
    SPOOL_OPENCODE_DIR: join(tmpDir, 'opencode'),
    OPENCODE_DATA_DIR: join(tmpDir, 'opencode'),
    SPOOL_PI_DIR: join(tmpDir, 'pi'),
    SPOOL_WORKBUDDY_DIR: join(tmpDir, 'workbuddy'),
    WORKBUDDY_CONFIG_DIR: join(tmpDir, 'workbuddy'),
  }

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    SPOOL_DATA_DIR: join(tmpDir, 'data'),
    SPOOL_ELECTRON_USER_DATA_DIR: join(tmpDir, 'electron-user-data'),
    SPOOL_HOME: join(tmpDir, 'spool-home'),
    SPOOL_CLAUDE_DIR: join(tmpDir, 'claude', 'projects'),
    SPOOL_CODEX_DIR: join(tmpDir, 'codex', 'sessions'),
    SPOOL_GEMINI_DIR: join(tmpDir, 'gemini-cli-home'),
    GEMINI_CLI_HOME: join(tmpDir, 'gemini-cli-home'),
    ...agentEnv,
    ELECTRON_DISABLE_GPU: '1',
    SPOOL_E2E_TEST: '1',
  }

  const args = [join(APP_DIR, 'out', 'main', 'index.mjs')]
  if (process.platform === 'linux') args.unshift('--no-sandbox')

  const app = await electron.launch({ args, cwd: APP_DIR, env })
  const window = await app.firstWindow()

  return {
    app,
    window,
    tmpDir,
    cleanup: async () => {
      await app.close()
      rmSync(tmpDir, { recursive: true, force: true })
    },
  }
}

/**
 * Force the Electron window into the given logical size + dark theme.
 * Use `1080×740` to match the app's documented default for release videos.
 */
export async function setDemoWindowBounds(
  ctx: AppContext,
  width: number,
  height: number,
): Promise<void> {
  await ctx.app.evaluate(
    async ({ app, BrowserWindow, nativeTheme }, bounds) => {
      nativeTheme.themeSource = 'dark'
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) throw new Error('No Electron window found')
      win.setBounds(bounds)
      win.center()
      win.show()
      app.focus({ steal: true })
    },
    { width, height },
  )
  await ctx.window.emulateMedia({ colorScheme: 'dark' })
  await ctx.window.waitForTimeout(300)
}

/**
 * Block until the library finishes its initial sync — status footer reports
 * a non-zero session count.
 */
export async function waitForDemoSync(window: Page): Promise<void> {
  await expect(window.locator('[data-testid="status-text"]')).toHaveAttribute(
    'data-session-count',
    /^[1-9]\d*$/,
    { timeout: 15000 },
  )
}
