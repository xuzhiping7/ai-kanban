<p align="center">
  <a href="https://vibekanban.com">
    <picture>
      <source srcset="packages/public/vibe-kanban-logo-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/public/vibe-kanban-logo.svg" media="(prefers-color-scheme: light)">
      <img src="packages/public/vibe-kanban-logo.svg" alt="Vibe Kanban Logo">
    </picture>
  </a>
</p>

<p align="center">这个项目改过来之后勉强能用，但是我也不维护了，我们自己做了一个更好的，原本项目设计得不太好。</p>

 
 

![](packages/public/vibe-kanban-screenshot-overview.png)

## 概述

在软件工程师大部分时间都在规划和审查编程智能体的时代，提升规划和审查效率是提高交付速度最有效的方式。

Vibe Kanban 为此而生。使用看板 Issue 来规划工作，可以私有使用，也可以团队协作。准备开始时，创建工作区让编程智能体来执行。

- **看板规划** — 在看板上创建、排序、分配 Issue
- **在工作区中运行编程智能体** — 每个工作区为智能体提供独立分支、终端和开发服务器
- **审查 diff 并添加行内评论** — 无需离开界面即可向智能体发送反馈
- **预览你的应用** — 内置浏览器，支持开发者工具、审查模式和设备模拟
- **切换 10+ 编程智能体** — Claude Code、Codex、Gemini CLI、GitHub Copilot、Amp、Cursor、OpenCode、Droid、CCR 和 Qwen Code
- **创建 PR 并合并** — 使用 AI 生成的描述创建 PR，在 GitHub 上审查并合并

![](packages/public/vibe-kanban-screenshot-workspace.png)

一行命令：描述工作、审查 diff、发布上线。
  
## 开发

### 前置条件

- [Rust](https://rustup.rs/)（最新 stable 版）
- [Node.js](https://nodejs.org/)（>=20）
- [pnpm](https://pnpm.io/)（>=8）

额外开发工具：
```bash
cargo install cargo-watch
cargo install sqlx-cli
```

安装依赖：
```bash
pnpm i
```

### 启动开发服务器

```bash
pnpm run dev
```

这会启动后端和 Web 应用。空白数据库将从 `dev_assets_seed` 文件夹复制。

### 构建 Web 应用

只构建 Web 前端：

```bash
cd packages/local-web
pnpm run build
```

### 从源码构建（macOS）

1. 运行 `./local-build.sh`
2. 测试：`cd npx-cli && node bin/cli.js`

### 环境变量

以下环境变量可在构建时或运行时配置：

| 变量 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `POSTHOG_API_KEY` | 构建时 | 空 | PostHog 分析 API Key（为空则禁用分析） |
| `POSTHOG_API_ENDPOINT` | 构建时 | 空 | PostHog 分析端点（为空则禁用分析） |
| `PORT` | 运行时 | 自动分配 | **生产模式**：服务器端口。**开发模式**：前端端口（后端使用 PORT+1） |
| `BACKEND_PORT` | 运行时 | `0`（自动分配） | 后端服务器端口（仅开发模式，覆盖 PORT+1） |
| `FRONTEND_PORT` | 运行时 | `3000` | 前端开发服务器端口（仅开发模式，覆盖 PORT） |
| `HOST` | 运行时 | `127.0.0.1` | 后端服务器主机地址 |
| `MCP_HOST` | 运行时 | 取 `HOST` 的值 | MCP 服务器连接主机（Windows 上 `HOST=0.0.0.0` 时使用 `127.0.0.1`） |
| `MCP_PORT` | 运行时 | 取 `BACKEND_PORT` 的值 | MCP 服务器连接端口 |
| `DISABLE_WORKTREE_CLEANUP` | 运行时 | 未设置 | 禁用所有 git worktree 清理（用于调试） |
| `VK_ALLOWED_ORIGINS` | 运行时 | 未设置 | 允许访问后端 API 的来源列表，逗号分隔（如 `https://my-vibekanban-frontend.com`） |
| `VK_SHARED_API_BASE` | 运行时 | 未设置 | 本地桌面 App 连接的远程/云端 API 地址 |
| `VK_SHARED_RELAY_API_BASE` | 运行时 | 未设置 | 中继 API 地址，用于隧道模式连接 |
| `VK_TUNNEL` | 运行时 | 未设置 | 设置后启用中继隧道模式（需要中继 API 地址） |

**构建时变量**必须在运行 `pnpm run build` 时设置。**运行时变量**在应用启动时读取。

#### 使用反向代理或自定义域名的自托管

在反向代理（如 nginx、Caddy、Traefik）或自定义域名后运行 Vibe Kanban 时，必须设置 `VK_ALLOWED_ORIGINS` 环境变量。否则浏览器的 Origin 头部与后端预期的主机不匹配，API 请求将被拒绝并返回 403。

将其设置为前端可访问的完整源 URL：

```bash
# 单个来源
VK_ALLOWED_ORIGINS=https://vk.example.com

# 多个来源（逗号分隔）
VK_ALLOWED_ORIGINS=https://vk.example.com,https://vk-staging.example.com
```


## 部署

如需在国内网络环境下部署完整功能（含项目管理和看板），请参阅 [部署须知](./docs/部署须知.md)。


### 远程部署

在远程服务器上运行 Vibe Kanban（如通过 systemctl、Docker 或云托管）时，可以配置编辑器通过 SSH 打开项目：

1. **通过隧道访问**：使用 Cloudflare Tunnel、ngrok 等工具暴露 Web UI
2. **在 设置 → 编辑器集成 中配置远程 SSH**：
   - 将 **Remote SSH Host** 设置为服务器主机名或 IP 地址
   - 将 **Remote SSH User** 设置为 SSH 用户名（可选）
3. **前置条件**：
   - 本地机器到远程服务器之间有 SSH 访问权限
   - 已配置 SSH 密钥（免密认证）
   - 安装 VSCode Remote-SSH 扩展

配置完成后，"在 VSCode 中打开"按钮将生成类似 `vscode://vscode-remote/ssh-remote+user@host/path` 的 URL，用于打开本地编辑器并连接到远程服务器。

详细设置说明请参阅[文档](https://vibekanban.com/docs/settings/general)。
