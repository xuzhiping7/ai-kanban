# DeepSeek-TUI Agent 接入设计

## 概述

将 [DeepSeek-TUI](https://github.com/Hmbown/DeepSeek-TUI) 集成为 Vibe Kanban 的新 Agent executor。

### DeepSeek-TUI 简介

- 本地终端 AI 编程助手，使用 DeepSeek 模型
- 版本：已安装 v0.8.28（路径：`/opt/homebrew/bin/deepseek`）
- 提供三种集成模式：
  - `deepseek serve --acp`：Agent Client Protocol（JSON-RPC 2.0 over stdio）
  - `deepseek serve --http`：HTTP/SSE Runtime API
  - `deepseek serve --mcp`：MCP stdio 服务器

### 接入方案：ACP 模式

选用 `deepseek serve --acp`，原因：

1. **复用现有基础设施**：项目已有 `AcpAgentHarness`（Gemini、Qwen 共用）
2. **实现量最小**：参照 Amp（163 行），无需 HTTP 客户端
3. **协议标准化**：ACP 是通用协议，spawn/follow-up/cancel 开箱即用
4. **DeepSeek-TUI 的 ACP 实现**：`initialize`、`session/new`、`session/prompt`、`session/cancel`

### 执行流程

```
spawn()
  → deepseek serve --acp
  → AcpAgentHarness 通过 stdio 发送 initialize
  → session/new → session/prompt (发送用户提示)
  → 通过 SSE 事件流接收输出

spawn_follow_up()
  → 重新连接已有 session
  → session/prompt (继续对话)
```

## 现有 Agent 接入模式

每个 Agent 需完成以下注册点：

| 注册点 | 文件 | 说明 |
|--------|------|------|
| 1. 模块文件 | `crates/executors/src/executors/<name>.rs` | 结构体 + trait 实现 |
| 2. 模块声明 | `crates/executors/src/executors/mod.rs` | `pub mod <name>;` |
| 3. 枚举变体 | `crates/executors/src/executors/mod.rs` | `CodingAgent` enum 新增变体 |
| 4. 导入语句 | `crates/executors/src/executors/mod.rs` | `use` 导入 |
| 5. 能力声明 | `crates/executors/src/executors/mod.rs` | `capabilities()` match 分支 |
| 6. MCP 配置 | `crates/executors/src/executors/mod.rs` | `get_mcp_config()` match 分支 |
| 7. 默认配置 | `crates/executors/default_profiles.json` | `DEEP_SEEK_TUI` profile |
| 8. Schema | `shared/schemas/deepseek_tui.json` | 前端需要的 JSON Schema |

## 实现步骤

### Step 1：创建 deepseek_tui.rs

参照 `amp.rs`（最简单）和 `qwen.rs`（ACP），创建：

```
crates/executors/src/executors/deepseek_tui.rs
```

关键实现：
- **结构体** `DeepSeekTui`：`append_prompt`、`model`、`auto_approve`、`auto_compact`、`CmdOverrides`、`approvals`
- **命令**：`deepseek serve --acp`
- **spawn()**：使用 `AcpAgentHarness::with_session_namespace("deepseek_sessions")`
- **spawn_follow_up()**：继续已有 session
- **normalize_logs()**：复用 ACP log normalization
- **get_availability_info()**：执行 `deepseek doctor --json` 检查安装状态

### Step 2：注册到 CodingAgent 枚举

在 `mod.rs` 中添加：
- `pub mod deepseek_tui;`
- `use ... deepseek_tui::DeepSeekTui;`
- `DeepSeekTui` 变体
- `capabilities()` 返回 `[SessionFork]`
- `get_mcp_config()` 使用默认 MCP 配置
- 兼容性别名：`DEEP_SEEK_TUI`

### Step 3：添加默认 profile

在 `default_profiles.json` 添加：
```json
"DEEP_SEEK_TUI": {
  "DEFAULT": {
    "DEEP_SEEK_TUI": {}
  }
}
```

### Step 4：Schema 生成

通过 `#[derive(JsonSchema)]` 自动生成 schema 文件。

## 与现有 Agent 的对比

| 特性 | Claude Code | Amp | Gemini | DeepSeek-TUI (新增) |
|------|-------------|-----|--------|---------------------|
| 启动方式 | `npx claude` | `npx amp` | `npx gemini` | `deepseek serve --acp` |
| 协议 | 自定义 stdio | JSON Lines stdio | ACP stdio | ACP stdio |
| 实现行数 | 1500+ | 163 | 250+ | ~200（预估） |
| 会话继续 | ✅ | ✅ | ✅ | ✅ |
| MCP | ✅ | ✅ | ✅ | 待确认 |

## 前置条件

- DeepSeek-TUI 已安装（`deepseek --version` ≥ 0.8.0，支持 `--acp`）
- API Key 已配置（`~/.deepseek/config.toml` 或 `DEEPSEEK_API_KEY` 环境变量）
