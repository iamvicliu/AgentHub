# 参与 AgentHub 开发

欢迎提问题、提建议或者直接改代码。AgentHub 是个人维护的项目，基于开源项目 [Spool](https://github.com/spool-lab/spool) `v0.6.3` 开发，与 Spool 官方无关联。

- **发现问题或有想法**：到 [Issues](https://github.com/iamvicliu/AgentHub/issues) 提。报 bug 时请写上 AgentHub 版本、macOS 版本，以及是 Apple 芯片还是 Intel 芯片。
- **小改动**（错别字、文档、界面细节）：可以直接提 Pull Request，不用先开 Issue。
- **大改动**：请先开 Issue 说一下思路，避免白做。

## 准备环境

需要 macOS，以及 [pnpm](https://pnpm.io/) `11.14.0`（版本以根目录 `package.json` 的 `packageManager` 为准）。

```bash
git clone https://github.com/iamvicliu/AgentHub.git
cd AgentHub
pnpm install --frozen-lockfile
pnpm dev
```

开发模式的数据放在 `~/.agenthub-dev/`，不会碰你正在用的 AgentHub 的数据（`~/.agenthub/`）。也可以用环境变量 `SPOOL_DATA_DIR` 指定别的目录。

## 原生模块 better-sqlite3

单元测试跑在 Node 上，应用跑在 Electron 上，两边需要的 `better-sqlite3` 二进制不一样，仓库里只保留一份。脚本会自动切换：

- `pnpm test` 运行前会先切到 Node 版本。
- `pnpm dev`、`pnpm test:e2e` 和所有 `package:*` 打包命令会临时切到 Electron 版本，跑完再切回 Node 版本。

如果中途按了 Ctrl-C，可能来不及切回去，之后会报 `NODE_MODULE_VERSION` 不匹配。这时按接下来要用的环境手动重建一次：

```bash
pnpm run rebuild:native:node      # 跑单元测试前
pnpm run rebuild:native:electron  # 跑应用或 e2e 测试前
```

## 提交改动前

1. 从 `main` 新建分支再改。
2. 修 bug 请顺带加一个能复现这个 bug 的测试；加功能请覆盖主要用法和空数据、出错这类边界情况。
3. 跑一遍下面的检查，都通过再提 Pull Request。

```bash
pnpm --filter @spool/app typecheck   # 类型检查
pnpm exec vp test run apps/app/src packages/core/src packages/session-view/src --no-file-parallelism   # 单元测试
pnpm test:e2e                        # 界面测试（Playwright），需要在桌面环境下运行
pnpm lint                            # 代码检查
```

提交信息用这几种前缀开头：`feat:`（新功能）、`fix:`（修 bug）、`docs:`（文档）、`refactor:`（重构）、`build:`（构建和打包）、`chore:`（杂项）。

## 打包和本地安装

```bash
pnpm run package:mac       # Apple 芯片 → apps/app/dist/mac-arm64/AgentHub.app
pnpm run package:mac:x64   # Intel 芯片 → apps/app/dist/mac/AgentHub.app
```

改了打包相关的东西，请检查打出来的应用能正常启动：

```bash
codesign --verify --deep --strict --verbose=2 apps/app/dist/mac-arm64/AgentHub.app
node apps/app/scripts/smoke-packaged.mjs apps/app/dist/mac-arm64/AgentHub.app
node apps/app/scripts/package-size-report.mjs apps/app/dist/mac-arm64/AgentHub.app
```

不要只靠搜索代码引用就删掉打包里的文件，有些文件是运行时动态加载的，搜不到。

想把自己构建的版本装到本机试用，可以一步完成：构建、装到 `/Applications/AgentHub.app`、打开。它会自动识别你的 Mac 是 Apple 芯片还是 Intel 芯片：

```bash
pnpm dev:install:mac
```

本地构建没有签名，脚本会自动去掉 macOS 的隔离标记，打开时不会被拦截。

## 代码结构

```text
apps/
  app/          AgentHub 桌面应用（Electron）
packages/
  core/         读取各 Agent 的本地会话、建索引（SQLite）、全文搜索
  redact/       敏感信息检测
  session-kit/  会话数据模型和解析
  session-view/ 会话渲染组件
```

AgentHub 只发布桌面应用。下面这些是上游 Spool 留下的，AgentHub 不使用，一般不用管：

- `apps/cli`、`apps/web`、`apps/backend`、`packages/share-kit`：上游的命令行工具、网站和云端分享服务。
- `scripts/share-dev.sh`、`scripts/release.sh`：上游云服务的开发脚本和 npm 包发布脚本，不要运行。

代码里的包名（`@spool/app`）和环境变量（`SPOOL_*`）也是上游留下的，改名牵涉太多，暂时保留。
