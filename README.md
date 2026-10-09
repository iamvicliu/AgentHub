[简体中文](README.md) · [English](README.en.md)

# AgentHub

**把 Claude Code、Codex、Cursor 等 10 种 AI Agent 的本地会话汇到一处，统一搜索、阅读和管理。**

用了好几个 AI 工具以后，想找回“上周那次是怎么解决的”，往往得挨个打开各个工具翻各家的历史记录。AgentHub 把这些会话收进一个列表：一次搜索就能搜遍所有 Agent，打开就能顺畅地读完整段对话。

- **只读、不打扰**：读取各 Agent 写在本机的会话记录，不做 IDE、不管理 worktree，也不改你的代码。
- **全部留在本机**：会话和索引都存在你的电脑上，不上传。
- **macOS 桌面应用**（Apple Silicon），界面支持简体中文、繁體中文、English、日本語、한국어、Deutsch、Français。

## 能做什么

### 一个列表看全部会话

- 所有 Agent 的会话混在一个列表里，可以按 Agent 筛选，筛选按钮上直接显示每个 Agent 有多少会话。
- 按最近、最早、消息最多或标题排序；常看的会话可以置顶。
- 每行显示最后活动时间、消息条数和模型。

### 搜索

- 同时搜索标题和正文，命中的词会高亮。标题命中排在前面，也可以改成按时间排。
- 按 `⌘K` 随时启动搜索。

### 阅读

- 清楚区分“我”和 Agent 的消息。
- **只看我的消息**：一键隐藏 Agent 的回复，快速回顾自己问过什么。
- **消息目录**：列出你在这个会话里的每一次提问，点一下就跳过去；目录宽度可以拖动调整。
- **会话内查找**：`⌘F` 查找，`⌘G` / `⌘⇧G` 跳到下一个 / 上一个；`⌘[` 返回列表，筛选和搜索都还在。
- 系统提示、子 Agent 记录这类内部内容默认隐藏，需要排查问题时可以在设置里打开。

### 管理

- **改名**：给会话起个好记的名字。（Codex 和 Hermes 的会话改名会自动同步回原 Agent；其他 Agent 只改 AgentHub 里的名字）
- **删除**：确认后把原始记录移进废纸篓，同时清理索引，误删了可以从废纸篓找回。
- **在终端继续**：Claude Code、Codex、Gemini CLI、OpenCode、Pi 的会话可以一键在终端里接着聊。终端工具可以自动识别，也可以自己指定。

### 自动同步

- Agent 写入新内容后，大约 2 秒就会出现在 AgentHub 里，不需要手动刷新；底部状态栏会显示“正在更新列表…”。
- 关掉窗口后 AgentHub 留在菜单栏继续同步；完全退出后，下次启动会自动补上这段时间的变化。
- 手动点击左下角的同步状态，可以立即做一次完整同步。

### 安全检查

在本机扫描会话里可能泄露的 API 密钥、密码、私钥和个人信息，方便在截图、复制或分享对话之前先检查一遍。扫描只在本机进行，但不能代替你自己的判断。

### Raycast 扩展：不开窗口也能搜

配合 AgentHub 的 Raycast 扩展「AI会话搜索」，在 Raycast 里就能直接搜遍所有 Agent 的会话：

- 输入关键词即时搜索，也可以按 Agent 筛选；留空显示最近的消息。
- 右侧预览消息正文，回车查看这条消息的前后文。
- 一键「在 AgentHub 查看」：打开 AgentHub 并定位、高亮这条消息。
- 还可以复制消息或会话 ID、在访达中显示原始记录；Codex 会话可以直接在 Codex 里打开。
- 只读访问 AgentHub 的本地索引，不改数据、不联网。

> Raycast 扩展需要另外安装，**稍后开源**。

### 第三方 App 对接

`agenthub://session/...` 链接可以直接打开某个会话并高亮其中一条消息，方便从笔记、Raycast 等工具跳回来。

## 支持的 Agent

| Agent            | 搜索和阅读 | 在终端继续 | 在 AgentHub 删除原始会话  | 改名同步回原 Agent | 用真实会话实测 |
| ---------------- | ---------- | ---------- | ------------------------- | ------------------ | -------------- |
| Claude Code      | ✓          | ✓          | ✓（会话还在运行时会拒绝） | —                  | ✓              |
| Codex CLI        | ✓          | ✓          | ✓                         | ✓                  | ✓              |
| Cursor           | ✓          | —          | —                         | —                  | ✓              |
| DeepSeek Harness | ✓          | —          | —                         | —                  | ✓              |
| Gemini CLI       | ✓          | ✓          | ✓                         | —                  | ⚠️ 未实测      |
| Hermes           | ✓          | —          | ✓（永久删除，不进废纸篓） | ✓                  | ✓              |
| OpenClaw         | ✓          | —          | —                         | —                  | ⚠️ 未实测      |
| OpenCode         | ✓          | ✓          | —                         | —                  | ✓              |
| Pi               | ✓          | ✓          | ✓                         | —                  | ⚠️ 未实测      |
| WorkBuddy        | ✓          | —          | ✓                         | —                  | ✓              |

- 不支持删除原始会话的 Agent，在 AgentHub 里点删除会先弹出说明，不会误删。
- 各 Agent 在自己应用里**归档**的会话，AgentHub 也不显示（WorkBuddy、DeepSeek Harness、Cursor、Codex）。

> ⚠️ **以下内容还没有用真实数据实测过**，只用测试数据验证了读取格式，可能有问题，遇到了欢迎[反馈](https://github.com/iamvicliu/AgentHub/issues)：
>
> - **Gemini CLI、OpenClaw、Pi** 三个 Agent 的全部功能（搜索阅读、在终端继续、删除）。
> - **OpenCode 和 Pi** 用 `agenthub://` 链接跳转到某条消息。
> - Cursor 的命令行版（cursor-agent）的会话**不支持**，只支持 Cursor 编辑器里的对话。

## 安装

1. 到 [Releases](https://github.com/iamvicliu/AgentHub/releases) 下载最新的 `AgentHub-版本号-arm64.dmg`（仅支持 Apple Silicon 芯片的 Mac）。
2. 打开 DMG，把 AgentHub 拖进“应用程序”文件夹。
3. 第一次打开时，macOS 会提示“无法验证开发者”或“已损坏，无法打开”。这是因为安装包**没有经过 Apple 公证**，不是文件真的坏了。任选一种方式放行：
   - 打开“系统设置 → 隐私与安全性”，在页面下方找到 AgentHub，点“仍要打开”；
   - 或者在“终端”里运行下面这行，然后重新打开：

     ```bash
     xattr -dr com.apple.quarantine /Applications/AgentHub.app
     ```

也可以按下方“开发与打包”自己构建。

## 数据与隐私

- 所有数据都在本机：AgentHub 的索引和设置在 `~/.agenthub/`，会话原文仍由各 Agent 自己保存。
- **改名**默认只改 AgentHub 里的名字，不动原 Agent 的记录（Codex、Hermes 例外，会同步回去）。
- **删除**会删掉原始记录，不只是在 AgentHub 里隐藏。删除前请先关掉正在写这个会话的 Agent。
- 某个 Agent 的数据目录暂时读不到时，AgentHub 不会清空它已有的索引。
- AgentHub 基于开源项目 Spool 开发，代码里仍保留了上游的更新检查和云端分享相关代码（界面上已经没有入口），所以它不是完全不联网的应用。

## 已知限制

- 打开链接时用的是已建好的索引；会话原文刚改过的话，先同步一次再打开。
- 会话原文被编辑、截断或重排后，指向其中某条消息的旧链接可能失效；AgentHub 会明确报错，不会跳到别的消息。
- AgentHub 完全退出时，Raycast 扩展的新搜索可能需要先打开 AgentHub；已经搜出来的结果可以直接跳转。

---

以下是技术说明，普通使用可以跳过。

## 技术说明

### 各 Agent 的数据位置

| Agent            | 默认读取位置                                                                                            | 可用的环境变量                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Claude Code      | `~/.claude/projects/<项目>/<id>.jsonl`                                                                  | `SPOOL_CLAUDE_DIR`                                             |
| Codex CLI        | `~/.codex/sessions/**/rollout-*.jsonl`（及 `.jsonl.zst`）                                               | `SPOOL_CODEX_DIR`                                              |
| Cursor           | `~/.cursor/projects/<工作区>/agent-transcripts/<id>/<id>.jsonl`，标题等取自 `globalStorage/state.vscdb` | `CURSOR_DATA_DIR`、`SPOOL_CURSOR_DIR`、`SPOOL_CURSOR_STATE_DB` |
| DeepSeek Harness | `~/.dsh/sessions/<项目>/<id>/session.v<N>.jsonl[.zstd]`                                                 | `DSH_HOME`、`SPOOL_DSH_DIR`                                    |
| Gemini CLI       | `~/.gemini/tmp/**/chats/session-*.json[l]`                                                              | `GEMINI_CLI_HOME`、`SPOOL_GEMINI_DIR`                          |
| Hermes           | `~/.hermes/state.db`、`~/.hermes/sessions/*.jsonl`                                                      | `HERMES_HOME`、`SPOOL_HERMES_DIR`                              |
| OpenClaw         | `~/.openclaw/agents/*/agent/openclaw-agent.sqlite`、`*/sessions/*.jsonl`                                | `OPENCLAW_STATE_DIR`、`SPOOL_OPENCLAW_DIR`                     |
| OpenCode         | `~/.local/share/opencode/opencode.db`                                                                   | `OPENCODE_DATA_DIR`、`SPOOL_OPENCODE_DIR`                      |
| Pi               | `~/.pi/agent/sessions/`                                                                                 | `SPOOL_PI_DIR`                                                 |
| WorkBuddy        | `~/.workbuddy/projects/<项目>/<id>.jsonl`                                                               | `WORKBUDDY_CONFIG_DIR`、`SPOOL_WORKBUDDY_DIR`                  |

- 数据库类来源（Hermes、OpenClaw、OpenCode、Cursor 状态库）一律只读打开。
- 子 Agent 的会话（Claude、WorkBuddy、DeepSeek Harness）不单独列出。
- Codex：原始会话和续接分段合并成一个会话，列表与 Codex App 一致（以 Codex 自己的会话表为准）。Codex 开启 `features.local_thread_store_compression` 后，会把约 7 天未写入的会话压缩成 `.jsonl.zst`，AgentHub 两种格式都能读。
- WorkBuddy：换过账号时旧账号的历史仍会收录，并在列表里标出账号；只有一个账号时不显示标记。
- DeepSeek Harness：压缩转写由多个 zstd 帧拼接而成，逐帧解压。
- Cursor：读取的是 Cursor 编辑器的数据；cursor-agent 命令行版的 `~/.cursor/chats/*/store.db` 暂未接入。

### 数据位置与标识

- 索引数据库 `~/.agenthub/agenthub.db`，设置、日志、备份也在 `~/.agenthub/`；开发模式用 `~/.agenthub-dev/`，可用 `SPOOL_DATA_DIR` 指定。
- 应用配置目录 `~/Library/Application Support/AgentHub`。
- 应用标识 `com.vicliu.agenthub`，链接协议 `agenthub://`，链接格式见 [本地会话链接](docs/local-session-links.md)。

### 开发与打包

使用仓库声明的 pnpm 版本：

```bash
pnpm install --frozen-lockfile
pnpm run rebuild:native:node
pnpm --filter @spool/app typecheck
pnpm exec vp test run apps/app/src packages/core/src packages/session-view/src --no-file-parallelism
pnpm run package:mac
```

- 目标平台为 macOS Apple Silicon。签名和公证需要你自己的开发者证书。
- `better-sqlite3` 必须匹配运行时；切到 Electron 开发时运行 `pnpm run rebuild:native:electron`。
- 不要使用上游的 `scripts/release.sh`：它面向上游的 npm 包发布，AgentHub 只发布桌面应用。

### 代码结构

```text
apps/
  app/          AgentHub 桌面应用（Electron）
  cli/          上游的命令行工具
  web/          上游的网站与在线阅读器
  backend/      上游的云端服务
packages/
  core/         本地会话读取、索引（SQLite）与全文搜索
  redact/       敏感信息检测
  session-kit/  会话数据模型与解析
  session-view/ 会话渲染组件
  share-kit/    上游的分享与导出
```

## 致谢

AgentHub 基于 [Spool](https://github.com/spool-lab/spool) `v0.6.3` 开发，感谢上游作者的开源实现。AgentHub 保留原作者署名和许可证，与 Spool 官方无关联，也不是 Spool 的新版本。

问题和建议请提交到 [Issues](https://github.com/iamvicliu/AgentHub/issues)。

## License

MIT

## Trademark

“Spool” and the Spool logo are trademarks of TypeSafe Limited. The MIT License covers the source code only and does not grant permission to use the Spool name or logo. See [LICENSE](LICENSE).
