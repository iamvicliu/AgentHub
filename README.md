# AgentHub

**把 Claude Code、Codex、Cursor 等 10 种 AI 编程 Agent 的本地会话汇到一处，统一搜索、阅读和管理。**

AgentHub 专注于“找回并读懂过去的会话”：读取各 Agent 写在本机的会话记录并建立索引，不做 IDE、不管理 worktree，也不改代码。会话数据和索引都留在本机。

当前版本：**`1.0.0`**，macOS（Apple Silicon）桌面应用。基于开源项目 [Spool](https://github.com/spool-lab/spool) `v0.6.3` 二次开发，与 Spool 官方无关联，也不是 Spool 的新版本。不是严格离线版：仓库仍保留上游的更新检查与云端相关代码。

为兼容既有索引和设置，内部继续使用 `~/.spool` 数据目录和原有 Chromium 配置目录。链接协议自 1.0.0 起为 `agenthub://`。

消息目录打开时定位到最新消息；左侧边缘可以拖动调整宽度并全局记忆。内部记录默认隐藏，查看入口位于“设置 → 通用 → 阅读”，不再占用会话工具条。
安全检查与安全设置使用统一的本地化分类名称；不提供上游的反馈入口。

## 主要功能

- **统一会话列表**：默认混排全部会话，单选筛选 Agent，支持排序和置顶，不再区分 Projects / Loose。
- **全文搜索**：标题在上、正文在下；标题与正文命中高亮；默认标题命中优先，各组按消息时间降序，支持切换排序和快速清空。
- **本地阅读**：普通进入会话默认显示最新消息，明确区分用户与 Agent，保留工具调用记录；修复新版 Codex 桌面记录漏掉全部用户消息的问题。
- **手动同步**：点击左下角同步状态，主动刷新会话与索引。
- **阅读筛选与目录**：可只看自己的消息，通过可收起的用户消息目录跳转；默认隐藏明确标记的系统和子 Agent 记录，可随时显示。只影响阅读，不删除记录；全局搜索仍覆盖完整索引。
- **全局阅读偏好**：“只看我的消息”和目录展开状态跨会话、重启后保留；搜索定位临时展示目标，不覆盖偏好。零会话的 Agent 不显示在筛选栏；详情操作使用图标和文字。
- **会话管理**：在 AgentHub 内改名；删除时确认后将原始记录移入废纸篓，同时清理索引和置顶。各来源能力不同，见下方“支持的 Agent”。
- **会话条数醒目**：列表每行的消息条数用暖橙色加粗显示，一眼区分长短会话。
- **消息深链接**：`agenthub://session/...` 打开本地会话并定位、高亮具体消息，可与单独维护的 Raycast 扩展集成。
- **桌面交互**：扩大点击区域，清理过时设置，强化设置页标题与说明层级；macOS 菜单提供“设置…”和 `Cmd+,`，原生菜单适配应用及系统语言。

安全检查页与设置页提供用途、检测限制和操作说明，区分显示隐藏、忽略与索引脱敏。会话内查找支持 `Cmd+G` / `Cmd+Shift+G`，查找框内也可用 `Enter` / `Shift+Enter`；`Cmd+[` 返回上一页，保留筛选和搜索状态。
终端设置自动发现已知终端，支持 Tern；也可添加自定义应用或可执行文件及 JSON 启动参数，用 `{command}` / `{cwd}` 占位符传入续接命令与目录。提供测试入口；显式选择的终端不可用时报告错误，不改用其他终端。

## 支持的 Agent

设置页列出的 10 个来源都已接入，均支持来源筛选、全文搜索和阅读。没有会话的来源不会出现在顶部筛选栏。

| Agent                   | 来源                | 实机验证   | 在终端继续 | 删除原始会话                             | 改名写回原 Agent            |
| ----------------------- | ------------------- | ---------- | ---------- | ---------------------------------------- | --------------------------- |
| Claude Code             | 上游                | 已验证     | 支持       | 支持（含会话目录与附属数据；运行中拒绝） | 否                          |
| Codex CLI               | 上游                | 已验证     | 支持       | 支持                                     | 支持（经 Codex app-server） |
| Gemini CLI              | 上游                | 仅格式夹具 | 支持       | 支持                                     | 否                          |
| OpenCode                | 上游，AgentHub 修复 | 已验证     | 支持       | 不支持（共享数据库）                     | 否                          |
| Pi                      | 上游                | 仅格式夹具 | 支持       | 支持                                     | 否                          |
| Hermes                  | AgentHub 新增       | 已验证     | 不支持     | 支持（经 Hermes CLI，永久删除）          | 支持（经 Hermes CLI）       |
| OpenClaw                | AgentHub 新增       | 仅格式夹具 | 不支持     | 不支持                                   | 否                          |
| WorkBuddy               | AgentHub 新增       | 已验证     | 不支持     | 支持                                     | 否                          |
| DeepSeek Harness（DSH） | AgentHub 新增       | 已验证     | 不支持     | 不支持（每个会话是一个目录）             | 否                          |
| Cursor                  | AgentHub 新增       | 已验证     | 不支持     | 不支持（列表来自 Cursor 自身的状态库）   | 否                          |

- “仅格式夹具”表示开发机上没有该 Agent 的真实会话，解析与同步只用测试数据验证过。
- “在终端继续”只在支持的来源上显示；不支持的来源不显示该按钮。
- 改名默认只改 AgentHub 索引，Codex 与 Hermes 会写回原 Agent。
- OpenCode / Pi 的消息深链接跳转尚未用真实数据验证。
- Codex：原始和续接分段合并为同一会话，增量同步读取 Resume 名称，会话列表以 Codex 自己的会话表为准。Codex 开启 `features.local_thread_store_compression` 后，会把约 7 天未写入的会话压缩成 `rollout-….jsonl.zst` 并删除原 `.jsonl`；AgentHub 两种格式都能读取。
- OpenCode：新版把 `model` / `agent` 从会话表移到每条消息的数据里，旧查询会报 `no such column: model`，导致会话完全无法索引；AgentHub 已改为从消息数据读取。
- Hermes / OpenClaw 的数据库只读接入；Pi 读取会话名称。

完整更新记录见 [CHANGELOG.md](CHANGELOG.md)，消息链接协议见 [本地会话链接](docs/local-session-links.md)。

### 菜单与后台同步

菜单栏菜单提供打开应用、设置、立即同步和退出，跟随界面语言；原有点击行为不变。
启动扫描成功后会监听源记录变化。关闭窗口仍可后台同步，完全退出应用则停止；重新启动会扫描并补齐仍存在的记录。当前没有独立后台同步服务。

## 数据与隐私

- 本地数据默认位于 `~/.spool/`，开发模式使用 `~/.spool-dev/`。不要将其中的数据库或会话记录提交到 Git。
- 改名只修改 AgentHub 索引，不改写 Agent 的原始标题；同步后仍保留自定义名称。Hermes 与 Codex 例外：分别通过 `hermes sessions rename` 和 Codex app-server 写回，两边标题一致。Codex 会话列表以 Codex 自己的会话表为准，与 Codex App 一致。
- 删除影响原始记录和索引，不只是隐藏会话。请先关闭正在写入该会话的 Agent；原始文件可从废纸篓恢复，索引可通过重新同步建立。
- OpenCode 使用共享数据库，目前拒绝按会话删除该数据库。Hermes 通过其自带的 `hermes sessions delete` 永久删除（不进废纸篓，连同委派子会话）；OpenClaw、DSH、Cursor 暂不支持从 AgentHub 删除原始会话，只能删除索引；其余来源的删除操作只处理已确认属于该会话且位于来源目录内的文件。
- 已确认删除的文件记录会清理索引；Hermes / OpenClaw 数据库中的删除也会同步清理。来源目录或数据库不可读时不清空索引。
- 主界面已移除 Shares，但 CLI、云端和更新检查代码仍保留。不要将此版本视为严格禁止联网的应用。
- 主界面提供安全检查入口、全局风险结果和重扫；扫描 worker 退出时请求明确报错，不再永久等待。扫描器不应作为对外分享前的唯一安全保证。

### 新数据源目录

- Hermes 默认读取 `~/.hermes/state.db` 与 `~/.hermes/sessions/*.jsonl`，尊重 `HERMES_HOME`；可用 `SPOOL_HERMES_DIR` 指定其他本地目录。
- OpenClaw 默认读取 `~/.openclaw/agents/*/agent/openclaw-agent.sqlite` 和 `*/sessions/*.jsonl`，尊重 `OPENCLAW_STATE_DIR`；可用 `SPOOL_OPENCLAW_DIR` 指定本地目录。
- Pi 默认读取 `~/.pi/agent/sessions/`，可用 `SPOOL_PI_DIR` 指定其他本地目录。
- WorkBuddy 默认读取 `~/.workbuddy/projects/<cwd-slug>/<uuid>.jsonl`，尊重 `WORKBUDDY_CONFIG_DIR`；可用 `SPOOL_WORKBUDDY_DIR` 指定其他本地目录。子代理转写（`<uuid>/subagents/*.jsonl`）不单独列出；`~/.workbuddy/workbuddy.db` 中 `status` 为 `archived` 的会话不显示。换过账号时 WorkBuddy 会把旧账号的历史留在同一目录，这些会话**同样收录**，并在列表里标出各自所属账号；只有一个账号时不显示标记。
- DSH 默认读取 `~/.dsh/sessions/<cwd-slug>/<session-id>/session.v<N>.jsonl[.zstd]`，尊重 `DSH_HOME`；可用 `SPOOL_DSH_DIR` 指定其他本地目录。同一会话存在多个格式版本时只读版本号最高的那个；子代理会话（`origin: subagent`）不单独列出；`~/.dsh/storages/workspace.json` 的 `archivedSessionIds` 中的会话不显示。
- Cursor 默认读取 Cursor 编辑器的 `~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl`，尊重 `CURSOR_DATA_DIR`；可用 `SPOOL_CURSOR_DIR` 指定其他本地目录。标题、模型、工作目录与归档状态只读取自 Cursor 的 `globalStorage/state.vscdb`（可用 `SPOOL_CURSOR_STATE_DB` 指定）；已归档的会话不显示，读不到时只少标题、不隐藏会话。暂不支持在 AgentHub 删除原始会话。cursor-agent 命令行版的 `~/.cursor/chats/*/store.db` 暂未接入。
- 不会自动连接远程主机或下载远程记录。新数据源暂不支持在终端继续。

## 已知限制

- AgentHub 完全退出且 SQLite WAL 辅助文件不存在时，Raycast 的新搜索可能需要先启动 AgentHub；已经加载的命中可以直接冷启动并定位。
- 消息链接校验完整内容指纹。源记录编辑、截断或重新排序后，旧链接可能失效；不会静默跳到其他消息。
- 打开链接依赖索引的新鲜度，不会即时重新解析源文件中的编辑；请先同步。
- 当前安装包可能早于源码版本。下述构建流程生成 AgentHub；上游下载入口不包含这些定制功能。

## 开发与打包

使用仓库声明的 pnpm 版本：

```bash
pnpm install --frozen-lockfile
pnpm run rebuild:native:node
pnpm --filter @spool/app typecheck
pnpm exec vp test run apps/app/src packages/core/src packages/session-view/src --no-file-parallelism
pnpm run package:mac
```

macOS 桌面目标为 Apple Silicon。签名及公证需要自己的开发者证书；本地未公证构建不等同于官方签名发行版。
`better-sqlite3` 必须匹配运行时，切换 Electron 开发时使用 `pnpm run rebuild:native:electron`。
不要使用上游 `scripts/release.sh` 发布这个桌面分支：它面向上游主分支及 npm 包发布。
AgentHub 只发布桌面应用，不发布上游的 npm 包。

## 上游项目

感谢上游 [Spool](https://github.com/spool-lab/spool) 的开源实现。AgentHub 保留原作者署名和许可证。
反馈请提交到 [Issues](https://github.com/iamvicliu/agenthub/issues)。

## 代码结构

```text
apps/
  app/          Electron desktop app for local session management
  cli/          CLI for indexing, sharing, reading, resuming, and automation
  web/          spool.pro: homepage, docs, Profiles, account pages, and Session reader
  backend/      Hub, identity, publication, and media API on Cloudflare
packages/
  core/         Local Session ingestion, organization, SQLite, and full-text search
  redact/       Sensitive-data detection shared by publishing surfaces
  session-kit/  Browser-safe Session model, canonical records, views, and diffs
  session-view/ Shared conversation renderer for Desktop and Web
  share-kit/    Curated `.spool` documents, templates, and export primitives
```

## License

MIT

## Trademark

“Spool” and the Spool logo are trademarks of TypeSafe Limited. The MIT License covers the source code only and does not grant permission to use the Spool name or logo. See [LICENSE](LICENSE).
