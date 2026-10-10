[English](README.en.md) · [简体中文](README.md)

# AgentHub

**All your local AI coding-agent sessions in one place — Claude Code, Codex, Cursor, and 7 more. Search, read, and manage them together.**

After juggling several AI tools, finding "how did I solve that last week" usually means opening each tool and digging through its own history. AgentHub gathers those sessions into one list: one search covers every agent, and one click opens the whole conversation.

- **Read-only, non-intrusive**: reads the session files your agents already write locally. It's not an IDE, doesn't manage worktrees, and never touches your code.
- **Everything stays local**: sessions and the index live on your machine; nothing is uploaded.
- **macOS desktop app** for both Apple silicon (M1/M2/M3/M4 and later) and Intel Macs, with a UI in 简体中文, 繁體中文, English, 日本語, 한국어, Deutsch, and Français.

## What it does

### One list for every session

- All agents' sessions mixed in a single list; filter by agent, with each filter showing how many sessions that agent has.
- Sort by most recent, oldest, most messages, or title; pin the sessions you return to.
- Each row shows last activity time, message count, and model.

### Search

- Searches titles and body at once, with matches highlighted. Title matches rank first; you can switch to chronological order.
- Press `⌘K` to start a search from anywhere.

### Reading

- Clearly separates "you" from the agent's messages.
- **Only my messages**: hide the agent's replies in one click to quickly review what you asked.
- **Message outline**: lists every question you asked in the session; click to jump, drag to resize the outline.
- **Find in session**: `⌘F` to find, `⌘G` / `⌘⇧G` for next / previous; `⌘[` goes back to the list with filters and search intact.
- Internal content such as system prompts and sub-agent records is hidden by default; turn it on in settings when you need to debug.

### Managing

- **Rename**: give a session a memorable name. (Renames for Codex and Hermes sync back to the original agent; other agents only change the name inside AgentHub.)
- **Delete**: after confirmation, moves the original record to the Trash and cleans up the index; recover from the Trash if you deleted by mistake.
- **Continue in terminal**: sessions from Claude Code, Codex, Gemini CLI, OpenCode, and Pi can be resumed in one click. The terminal app is auto-detected, or you can specify one.

### Auto-sync

- New content an agent writes shows up in AgentHub about 2 seconds later — no manual refresh; the bottom status bar shows "Updating list…".
- Close the window and AgentHub keeps syncing from the menu bar; after a full quit, the next launch catches up on what changed in between.
- Click the sync status in the bottom-left to run a full sync immediately.

### Security scan

Scans sessions locally for API keys, passwords, private keys, and personal information that might leak, so you can check before screenshotting, copying, or sharing a conversation. The scan runs only on your machine and doesn't replace your own judgment.

### Raycast extension: search without opening the window

Pair AgentHub with its Raycast extension "AgentHub会话搜索" (AgentHub Session Search) to search every agent's sessions right inside Raycast:

- Type to search instantly, or filter by agent; leave it empty to show recent messages.
- Preview the message body on the right; press Enter to see that message in context.
- "View in AgentHub": opens AgentHub and jumps to, and highlights, that message.
- Copy a message or session ID, or reveal the original record in Finder; Codex sessions can be opened directly in Codex.
- Read-only access to AgentHub's local index — no data changes, no network.

> The Raycast extension is installed separately; see [AgentHub会话搜索](https://github.com/iamvicliu/Script/tree/main/Raycast/AgentHub-Search) for source and install steps.

### Third-party app integration

`agenthub://session/...` links open a specific session and highlight one message, making it easy to jump back from notes, Raycast, and other tools.

## Supported agents

| Agent            | Search & read | Resume in terminal | Delete original in AgentHub | Rename syncs back | Tested with real sessions |
| ---------------- | ------------- | ------------------ | --------------------------- | ----------------- | ------------------------- |
| Claude Code      | ✓             | ✓                  | ✓ (refused while running)   | —                 | ✓                         |
| Codex CLI        | ✓             | ✓                  | ✓                           | ✓                 | ✓                         |
| Cursor           | ✓             | —                  | —                           | —                 | ✓                         |
| DeepSeek Harness | ✓             | —                  | —                           | —                 | ✓                         |
| Gemini CLI       | ✓             | ✓                  | ✓                           | —                 | ⚠️ Not tested             |
| Hermes           | ✓             | —                  | ✓ (permanent, no Trash)     | ✓                 | ✓                         |
| OpenClaw         | ✓             | —                  | —                           | —                 | ⚠️ Not tested             |
| OpenCode         | ✓             | ✓                  | —                           | —                 | ✓                         |
| Pi               | ✓             | ✓                  | ✓                           | —                 | ⚠️ Not tested             |
| WorkBuddy        | ✓             | —                  | ✓                           | —                 | ✓                         |

- For agents that don't support deleting the original session, clicking delete in AgentHub shows an explanation first, so you won't delete by accident.
- Sessions an agent **archives** in its own app are also hidden in AgentHub (WorkBuddy, DeepSeek Harness, Cursor, Codex).

> ⚠️ **The following has not been tested with real data** — only the read format was verified with test data. It may have bugs; please [report](https://github.com/iamvicliu/AgentHub/issues) any you find:
>
> - All features of **Gemini CLI, OpenClaw, and Pi** (search/read, resume in terminal, delete).
> - `agenthub://` deep links into a specific message for **OpenCode and Pi**.
> - Cursor's command-line variant (cursor-agent) is **not supported** — only conversations in the Cursor editor.
> - The **Intel build** is cross-compiled on an Apple silicon Mac and hasn't been run on real Intel hardware yet.

## Installation

1. From [Releases](https://github.com/iamvicliu/AgentHub/releases), download the installer that matches your Mac:
   - **Apple silicon** (M1, M2, M3, M4, etc.): `AgentHub-<version>-Apple-Silicon.dmg`
   - **Intel**: `AgentHub-<version>-Intel.dmg`

   Not sure which one you have? Open the Apple menu → About This Mac. If it lists a “Chip” starting with Apple M, it’s Apple silicon; if it lists an Intel “Processor”, it’s Intel.

2. Open the DMG and drag AgentHub into Applications.
3. On first launch macOS will say "cannot verify the developer" or "damaged and can't be opened". This is because the package is **not Apple-notarized** — the file is not actually broken. Allow it either way:
   - Open "System Settings → Privacy & Security" and click "Open Anyway" for AgentHub;
   - or run this in Terminal, then reopen:

     ```bash
     xattr -dr com.apple.quarantine /Applications/AgentHub.app
     ```

You can also build it yourself — see "Development & packaging" below.

## Data & privacy

- Everything stays on your machine: AgentHub's index and settings live in `~/.agenthub/`, while the original sessions remain where each agent stores them.
- **Rename** by default only changes the name inside AgentHub and leaves the original agent's records alone (Codex and Hermes are the exception — they sync back).
- **Delete** removes the original record, not just hides it in AgentHub. Quit the agent that is writing that session before deleting.
- If an agent's data directory is temporarily unreadable, AgentHub won't wipe the index it already has.
- AgentHub is built on the open-source project Spool, and the code still retains upstream update-check and cloud-sharing code (no UI entry point anymore), so it is not a fully offline app.

## Known limitations

- Opening a link uses the already-built index; if the session text just changed, sync once before opening.
- After the session text is edited, truncated, or reordered, old links pointing to a specific message may break; AgentHub reports a clear error instead of jumping to the wrong message.
- When AgentHub is fully quit, a new search in the Raycast extension may need AgentHub opened first; already-fetched results still jump directly.

---

The rest is technical; skip it for normal use.

## Technical notes

### Where each agent stores its data

| Agent            | Default location                                                                                                 | Env vars                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Claude Code      | `~/.claude/projects/<project>/<id>.jsonl`                                                                        | `SPOOL_CLAUDE_DIR`                                             |
| Codex CLI        | `~/.codex/sessions/**/rollout-*.jsonl` (and `.jsonl.zst`)                                                        | `SPOOL_CODEX_DIR`                                              |
| Cursor           | `~/.cursor/projects/<workspace>/agent-transcripts/<id>/<id>.jsonl`; titles come from `globalStorage/state.vscdb` | `CURSOR_DATA_DIR`, `SPOOL_CURSOR_DIR`, `SPOOL_CURSOR_STATE_DB` |
| DeepSeek Harness | `~/.dsh/sessions/<project>/<id>/session.v<N>.jsonl[.zstd]`                                                       | `DSH_HOME`, `SPOOL_DSH_DIR`                                    |
| Gemini CLI       | `~/.gemini/tmp/**/chats/session-*.json[l]`                                                                       | `GEMINI_CLI_HOME`, `SPOOL_GEMINI_DIR`                          |
| Hermes           | `~/.hermes/state.db`, `~/.hermes/sessions/*.jsonl`                                                               | `HERMES_HOME`, `SPOOL_HERMES_DIR`                              |
| OpenClaw         | `~/.openclaw/agents/*/agent/openclaw-agent.sqlite`, `*/sessions/*.jsonl`                                         | `OPENCLAW_STATE_DIR`, `SPOOL_OPENCLAW_DIR`                     |
| OpenCode         | `~/.local/share/opencode/opencode.db`                                                                            | `OPENCODE_DATA_DIR`, `SPOOL_OPENCODE_DIR`                      |
| Pi               | `~/.pi/agent/sessions/`                                                                                          | `SPOOL_PI_DIR`                                                 |
| WorkBuddy        | `~/.workbuddy/projects/<project>/<id>.jsonl`                                                                     | `WORKBUDDY_CONFIG_DIR`, `SPOOL_WORKBUDDY_DIR`                  |

- Database-backed sources (Hermes, OpenClaw, OpenCode, Cursor state store) are always opened read-only.
- Sub-agent sessions (Claude, WorkBuddy, DeepSeek Harness) are not listed separately.
- Codex: original sessions and continuation segments are merged into one session, matching the Codex app (based on Codex's own session table). With `features.local_thread_store_compression` enabled, Codex compresses sessions idle for ~7 days into `.jsonl.zst`; AgentHub reads both formats.
- WorkBuddy: history from a previous account is still collected and tagged with the account in the list; no tag when there's only one account.
- DeepSeek Harness: compressed transcripts are concatenated zstd frames, decompressed frame by frame.
- Cursor: reads the Cursor editor's data; the command-line variant's `~/.cursor/chats/*/store.db` is not yet supported.

### Data location & identifiers

- Index database `~/.agenthub/agenthub.db`; settings, logs, and backups also live in `~/.agenthub/`. Development mode uses `~/.agenthub-dev/`, overridable via `SPOOL_DATA_DIR`.
- App config directory: `~/Library/Application Support/AgentHub`.
- App id `com.vicliu.agenthub`, URL scheme `agenthub://`; link format in [Local session links](docs/local-session-links.md).

### Development & packaging

Use the pnpm version declared by the repo:

```bash
pnpm install --frozen-lockfile
pnpm run rebuild:native:node
pnpm --filter @spool/app typecheck
pnpm exec vp test run apps/app/src packages/core/src packages/session-view/src --no-file-parallelism
pnpm run package:mac
```

- Target platform is macOS: run `pnpm run package:mac` for Apple silicon and `pnpm run package:mac:x64` for Intel. Signing and notarization require your own developer certificate.
- `better-sqlite3` must match the runtime; run `pnpm run rebuild:native:electron` when switching to Electron development.
- Don't use upstream's `scripts/release.sh`: it publishes the upstream npm packages; AgentHub only ships the desktop app.

### Code layout

```text
apps/
  app/          AgentHub desktop app (Electron)
  cli/          upstream CLI
  web/          upstream website & online reader
  backend/      upstream cloud service
packages/
  core/         local session reading, indexing (SQLite) & full-text search
  redact/       sensitive-data detection
  session-kit/  session data model & parsing
  session-view/ session rendering components
  share-kit/    upstream sharing & export
```

## Acknowledgements

AgentHub is built on [Spool](https://github.com/spool-lab/spool) `v0.6.3`; thanks to the upstream authors for their open-source work. AgentHub keeps the original attribution and license, is not affiliated with Spool, and is not a new version of Spool.

Questions and suggestions go to [Issues](https://github.com/iamvicliu/AgentHub/issues).

## License

MIT

## Trademark

“Spool” and the Spool logo are trademarks of TypeSafe Limited. The MIT License covers the source code only and does not grant permission to use the Spool name or logo. See [LICENSE](LICENSE).
