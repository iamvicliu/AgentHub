#!/usr/bin/env node
// Launch AgentHub on synthetic sessions for README screenshots. Never reads
// real data: every agent source and the app's own data dir point into a
// throwaway temp dir, which is deleted when the app quits.
//
//   node scripts/demo-screenshot.mjs zh   # Chinese UI + Chinese sessions
//   node scripts/demo-screenshot.mjs en   # English UI + English sessions
//
// Requires a current `pnpm run build` (uses out/main/index.mjs).
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const lang = process.argv[2]
if (lang !== 'zh' && lang !== 'en') {
  console.error('Usage: node scripts/demo-screenshot.mjs <zh|en>')
  process.exit(2)
}

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const root = mkdtempSync(join(tmpdir(), `agenthub-demo-${lang}-`))
const now = Date.now()
const iso = (hoursAgo, plusSeconds = 0) =>
  new Date(now - hoursAgo * 3_600_000 + plusSeconds * 1000).toISOString()
const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

// [agent, project, hoursAgo, title, turns]; turns alternate user / assistant.
const SESSIONS = {
  zh: [
    [
      'claude',
      'blog',
      1,
      '首页在手机上横向溢出',
      [
        '首页在 iPhone 上可以左右滑动，应该是哪里宽度超了，帮我查一下。',
        '问题出在 `Hero` 组件：标题用了 `white-space: nowrap`，长标题把容器撑宽了。\n\n```css\n.hero-title {\n  white-space: normal;\n  overflow-wrap: anywhere;\n}\n```\n\n改完后在 375px 宽度下不再出现横向滚动条。',
        '好了。顺便把导航栏在小屏下改成汉堡菜单？',
        '可以。我把导航拆成 `DesktopNav` 和 `MobileNav` 两个组件，768px 以下显示汉堡按钮，点击后从右侧滑出菜单，并且锁定页面滚动。',
      ],
    ],
    [
      'codex',
      'payments',
      3,
      '支付回调偶发 502',
      [
        '支付平台的回调偶尔返回 502，只在测试环境出现，怎么排查？',
        '先看网关日志里 502 的时间点。测试环境的出站流量走公司代理，回调处理里又同步调用了一次支付平台的查询接口，代理超时就会让整个请求超过网关的 30 秒限制。',
        '确实是代理。怎么改比较稳？',
        '回调里只做验签和落库，立刻返回 200；查询订单状态放到后台任务里异步执行，失败自动重试三次。这样回调本身永远不会被外部接口拖慢。',
      ],
    ],
    [
      'gemini',
      'docs-site',
      5,
      '给更新日志页面加搜索',
      [
        '更新日志页面越来越长，想加一个搜索框。',
        '内容是静态生成的，可以在构建时生成一份 JSON 索引，前端用 MiniSearch 做本地全文搜索，不需要后端。输入时防抖 150 毫秒，命中的版本号和段落高亮显示。',
      ],
    ],
    [
      'claude',
      'payments',
      20,
      '把订单导出改成后台任务',
      [
        '导出一年的订单会超时，怎么改？',
        '把导出改成后台任务：接口只负责创建任务并返回任务 ID，任务跑完把 CSV 上传到对象存储，再通知用户下载。前端轮询任务状态，显示进度条。',
      ],
    ],
    [
      'codex',
      'blog',
      26,
      '图片懒加载导致布局跳动',
      [
        '文章里的图片加载时页面会跳一下。',
        '给每张图片写死宽高比：构建时读取图片尺寸，输出 `width` 和 `height` 属性，浏览器就能提前占位，加载时不再跳动。',
      ],
    ],
    [
      'claude',
      'cli-tools',
      30,
      '写一个批量重命名照片的脚本',
      [
        '帮我写个脚本，按拍摄日期批量重命名照片。',
        '用 `exiftool` 读取拍摄时间，重命名成 `2026-05-08_143012.jpg` 这样的格式；同一秒拍的多张自动加序号。先加 `--dry-run` 参数只打印不执行，确认无误再真正改名。',
      ],
    ],
    [
      'gemini',
      'cli-tools',
      50,
      '定时备份数据库到对象存储',
      [
        '每天凌晨备份一次数据库，保留 30 天。',
        '用 cron 每天 3 点运行 `pg_dump`，压缩后上传到对象存储，文件名带日期；再给存储桶设置 30 天自动过期的生命周期规则，旧备份会自动清理。',
      ],
    ],
    [
      'codex',
      'docs-site',
      72,
      '修复深色模式下代码块看不清',
      [
        '深色模式下代码块的注释几乎看不见。',
        '代码高亮主题没有跟着切换。改成根据 `prefers-color-scheme` 分别加载 `github-light` 和 `github-dark` 两套主题，注释颜色对比度都能达到 4.5:1。',
      ],
    ],
    [
      'claude',
      'blog',
      96,
      '评论区接入垃圾评论过滤',
      [
        '最近垃圾评论很多，有什么轻量的办法？',
        '先加两层：隐藏的诱饵输入框（机器人会填、真人看不见），以及同一 IP 每分钟最多 3 条的限流。这两步通常能挡掉九成以上，不用接第三方服务。',
      ],
    ],
  ],
  en: [
    [
      'claude',
      'blog',
      1,
      'Home page overflows sideways on mobile',
      [
        'The home page scrolls sideways on iPhone. Something must be too wide — can you find it?',
        'It is the `Hero` component: the title uses `white-space: nowrap`, so long titles stretch the container.\n\n```css\n.hero-title {\n  white-space: normal;\n  overflow-wrap: anywhere;\n}\n```\n\nAt 375px wide the horizontal scrollbar is gone.',
        'Nice. Can you also turn the nav into a hamburger menu on small screens?',
        'Sure. I split the nav into `DesktopNav` and `MobileNav`; below 768px a hamburger button opens a slide-in menu from the right and locks page scroll.',
      ],
    ],
    [
      'codex',
      'payments',
      3,
      'Payment webhook randomly returns 502',
      [
        'The payment provider webhook sometimes returns 502, only on staging. How do I track it down?',
        "Start with the gateway logs around the 502s. Staging routes outbound traffic through the corporate proxy, and the webhook handler calls the provider's order API synchronously — when the proxy is slow, the request blows past the gateway's 30-second limit.",
        'It is the proxy. What is the most robust fix?',
        'Only verify the signature and store the event in the webhook, then return 200 right away. Move the order status lookup to a background job with three automatic retries, so the webhook can never be slowed down by an external API.',
      ],
    ],
    [
      'gemini',
      'docs-site',
      5,
      'Add search to the changelog page',
      [
        'The changelog page keeps growing. I would like a search box.',
        'The content is statically generated, so build a JSON index at build time and use MiniSearch for client-side full-text search — no backend needed. Debounce input by 150 ms and highlight matching versions and paragraphs.',
      ],
    ],
    [
      'claude',
      'payments',
      20,
      'Move order export to a background job',
      [
        'Exporting a year of orders times out. How should I change it?',
        'Make export a background job: the endpoint just creates a job and returns its ID, the job uploads a CSV to object storage when done, then notifies the user. The frontend polls the job status and shows a progress bar.',
      ],
    ],
    [
      'codex',
      'blog',
      26,
      'Lazy-loaded images make the layout jump',
      [
        'Pages jump while images in posts are loading.',
        'Give every image a fixed aspect ratio: read image sizes at build time and emit `width` and `height` attributes, so the browser reserves space and nothing shifts while loading.',
      ],
    ],
    [
      'claude',
      'cli-tools',
      30,
      'Script to batch-rename photos',
      [
        'Write me a script that renames photos by the date they were taken.',
        'Use `exiftool` to read the capture time and rename to `2026-05-08_143012.jpg`; shots taken in the same second get a sequence number. Run with `--dry-run` first to print the changes, then run it for real.',
      ],
    ],
    [
      'gemini',
      'cli-tools',
      50,
      'Nightly database backup to object storage',
      [
        'Back up the database every night and keep 30 days.',
        'Run `pg_dump` from cron at 3 AM, compress it, and upload to object storage with the date in the file name. Add a 30-day expiration lifecycle rule on the bucket so old backups clean themselves up.',
      ],
    ],
    [
      'codex',
      'docs-site',
      72,
      'Code blocks are unreadable in dark mode',
      [
        'Comments in code blocks are almost invisible in dark mode.',
        'The highlighting theme does not switch. Load `github-light` and `github-dark` based on `prefers-color-scheme`; comment contrast now reaches 4.5:1 in both.',
      ],
    ],
    [
      'claude',
      'blog',
      96,
      'Filter spam in the comments',
      [
        'There has been a lot of comment spam lately. Any lightweight fix?',
        'Add two layers: a hidden honeypot field (bots fill it, people never see it) and a limit of 3 comments per minute per IP. That usually stops over 90% of spam without a third-party service.',
      ],
    ],
  ],
}

const MODELS = { claude: 'claude-opus-5-5', codex: 'gpt-5.4', gemini: 'gemini-2.5-pro' }
const cwdFor = (project) => `/Users/demo/Code/${project}`
const geminiProjects = {}

SESSIONS[lang].forEach(([agent, project, hoursAgo, title, turns], i) => {
  const id = uuid(i + 1)
  const cwd = cwdFor(project)
  const at = (t) => iso(hoursAgo, t * 45)
  if (agent === 'claude') {
    const lines = [JSON.stringify({ type: 'custom-title', sessionId: id, cwd, customTitle: title })]
    let parent
    turns.forEach((text, t) => {
      const role = t % 2 === 0 ? 'user' : 'assistant'
      const msgId = `${id}-${t + 1}`
      lines.push(
        JSON.stringify({
          type: role,
          sessionId: id,
          cwd,
          uuid: msgId,
          timestamp: at(t),
          ...(parent ? { parentUuid: parent } : {}),
          message:
            role === 'user'
              ? { role, content: text }
              : { role, model: MODELS.claude, content: [{ type: 'text', text }] },
        }),
      )
      parent = msgId
    })
    write(join(root, 'claude', project, `${id}.jsonl`), lines.join('\n') + '\n')
  } else if (agent === 'codex') {
    const start = iso(hoursAgo)
    const lines = [
      { timestamp: start, type: 'session_meta', payload: { id, cwd } },
      { timestamp: start, type: 'turn_context', payload: { model: MODELS.codex, cwd } },
      ...turns.map((text, t) => ({
        timestamp: at(t),
        type: 'event_msg',
        payload:
          t % 2 === 0
            ? { type: 'user_message', message: text }
            : { type: 'agent_message', message: text },
      })),
    ]
    const d = new Date(start)
    const day = [
      String(d.getUTCFullYear()),
      String(d.getUTCMonth() + 1).padStart(2, '0'),
      String(d.getUTCDate()).padStart(2, '0'),
    ]
    write(
      join(
        root,
        'codex',
        ...day,
        `rollout-${start.replace(/:/g, '-').replace(/\.\d+Z$/, '')}-${id}.jsonl`,
      ),
      lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
    )
  } else {
    geminiProjects[cwd] = project
    write(join(root, 'gemini-home', '.gemini', 'history', project, '.project_root'), cwd)
    write(
      join(
        root,
        'gemini-home',
        '.gemini',
        'tmp',
        project,
        'chats',
        `session-${iso(hoursAgo).slice(0, 16).replace(':', '-')}-${id.slice(-8)}.json`,
      ),
      JSON.stringify(
        {
          sessionId: id,
          projectHash: project,
          startTime: at(0),
          lastUpdated: at(turns.length - 1),
          kind: 'main',
          summary: title,
          messages: turns.map((text, t) =>
            t % 2 === 0
              ? { id: `${id}-${t}`, timestamp: at(t), type: 'user', content: [{ text }] }
              : {
                  id: `${id}-${t}`,
                  timestamp: at(t),
                  type: 'gemini',
                  content: text,
                  model: MODELS.gemini,
                },
          ),
        },
        null,
        2,
      ),
    )
  }
})
write(
  join(root, 'gemini-home', '.gemini', 'projects.json'),
  JSON.stringify({ projects: geminiProjects }, null, 2),
)

// App data: UI language (agents.json) and theme (ui.json).
const home = join(root, 'agenthub')
write(join(home, 'agents.json'), JSON.stringify({ language: lang === 'zh' ? 'zh-CN' : 'en' }))
write(join(home, 'ui.json'), JSON.stringify({ themeSource: 'system' }))

// Every supported agent points into the temp dir; unseeded ones get empty dirs.
const empty = (name) => {
  const p = join(root, 'empty', name)
  mkdirSync(p, { recursive: true })
  return p
}
const env = {
  ...process.env,
  SPOOL_DATA_DIR: home,
  SPOOL_HOME: home,
  SPOOL_ELECTRON_USER_DATA_DIR: join(root, 'electron-user-data'),
  SPOOL_CLAUDE_DIR: join(root, 'claude'),
  SPOOL_CODEX_DIR: join(root, 'codex'),
  SPOOL_GEMINI_DIR: join(root, 'gemini-home'),
  GEMINI_CLI_HOME: join(root, 'gemini-home'),
  SPOOL_CURSOR_DIR: empty('cursor'),
  CURSOR_DATA_DIR: empty('cursor'),
  SPOOL_CURSOR_STATE_DB: join(empty('cursor'), 'state.vscdb'),
  SPOOL_DSH_DIR: empty('dsh'),
  DSH_HOME: empty('dsh'),
  SPOOL_HERMES_DIR: empty('hermes'),
  HERMES_HOME: empty('hermes'),
  SPOOL_OPENCLAW_DIR: empty('openclaw'),
  OPENCLAW_STATE_DIR: empty('openclaw'),
  SPOOL_OPENCODE_DIR: empty('opencode'),
  OPENCODE_DATA_DIR: empty('opencode'),
  SPOOL_PI_DIR: empty('pi'),
  SPOOL_WORKBUDDY_DIR: empty('workbuddy'),
  WORKBUDDY_CONFIG_DIR: empty('workbuddy'),
  CODEX_HOME: empty('codex-home'),
}

console.log(`Demo data: ${root}`)
console.log('Quit AgentHub (⌘Q) when done; the temp data is deleted automatically.')
const child = spawn(
  process.execPath,
  [
    join(appDir, '..', '..', 'scripts', 'with-electron-native.mjs'),
    'pnpm',
    'exec',
    'electron',
    join(appDir, 'out', 'main', 'index.mjs'),
  ],
  { cwd: appDir, env, stdio: 'inherit' },
)
child.on('exit', (code) => {
  rmSync(root, { recursive: true, force: true })
  process.exit(code ?? 0)
})
