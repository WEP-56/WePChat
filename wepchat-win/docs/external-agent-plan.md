# WePChat Windows 外部 Agent 形态草案

> 状态：清理后保留产品形态，不保留旧 ACP/Codex 实现方案  
> 更新：2026-07-24  
> 约束：必须参考 AionUi 实现（优先）或官方 ACP/RPC 文档（补充）；禁止脱离参考实现独立造轮子。

## 1. 产品定位

外部 Agent 是 WePChat 的高级、可选、本地 agent CLI 工作区模式。

它默认关闭，不影响普通聊天和生图。用户在设置里打开 `外部连接` 并启用具体 agent 后，后续才允许出现对应入口。进入入口也不应自动连接，只有用户开始对话后才启动连接，避免增加日常使用负担。

当前重新规划后的候选范围：

- Codex：必备，优先研究官方 RPC / JSON-RPC 路径。
- Claude Code：必备，允许单独做 CLI 连接支持。
- Pi：保留为 JSON-RPC / RPC 候选。

旧的 `codex --acp` / 临时 `codex exec --json` 实现不再作为正式方案继续推进。

## 2. 复用原则

外部 Agent 的 UI/UX 不应重新造一套工作台，而应尽量复用 WePChat 普通对话模式。

普通对话模式已经具备成熟的消息滚动、消息列表、工具调用状态卡、发送/停止状态、右侧文件视图、左右栏布局等能力。外部 Agent 模式只是普通对话模式的“项目化 + 外部 runtime”变体，不是一个全新的界面产品。

复用要求：

- 消息区继续使用普通对话的滚动、气泡、工具调用卡、状态卡和错误展示。
- 左侧边栏只做微调：从普通会话列表改为“项目目录包含会话”的树形收纳形态，整体状态和交互不变。
- 中部对话区只增加必要入口：agent 状态、项目选择、模型/模式开关、上下文显示等；其余消息和 composer 行为尽量沿用现有实现。
- 右侧边栏继续复用已有文件能力；只新增终端和 diff/review tab，不重新实现文件系统视图。
- 左右栏伸缩、拖拽、折叠状态应复用现有 shell 能力，避免新写独立布局系统。
- 只有连接层、agent adapter、项目/会话归属关系是新增核心；UI 层应保持克制。

因此，新计划开工时优先寻找现有模块可复用点，再决定是否新增代码。禁止为了外部 Agent 单独复制一套聊天、文件、滚动、工具卡或布局实现。

## 3. 三栏工作区形态

外部 Agent 模式仍沿用 WePChat 的三栏骨架：

```text
┌────────┬─────────────────────┬──────────────────────────────┬──────────────────────────┐
│ 主导航 │ 项目 / 会话树        │ Agent 对话区                  │ 文件 / 终端 / 审阅         │
├────────┼─────────────────────┼──────────────────────────────┼──────────────────────────┤
│ icons  │ project tree         │ messages + agent composer     │ real project workspace    │
└────────┴─────────────────────┴──────────────────────────────┴──────────────────────────┘
```

左侧侧边栏：

- 切换为项目树。
- 项目目录名就是项目名。
- 每个项目匹配零个或多个会话。
- 支持展开、收起、切换会话。
- 同一项目在不同 agent 下的会话完全独立。

中间对话区域：

- 顶部展示当前 agent、项目、会话、运行状态。
- Composer 包含项目目录选择、模型/模式能力、上下文容量展示、发送/停止。
- agent 不支持的能力直接显示“不支持”，不做估算或伪装。
- 任务未开始前不启动本地进程或 RPC 连接。

右侧工作区：

- 文件：来自真实项目目录。
- 终端：基础 PowerShell，cwd 为当前项目目录。
- 审阅：后续可做只读 diff，打开后显示有 diff 的文件名列表，点击展开红绿代码块。

## 4. 参考来源

当前参考优先级：

- Codex：参考 `wepchat-host` 内已有 RPC / app-server 示范，优先走官方 RPC / JSON-RPC 路径。
- Pi / 桌面 agent 工作区：重点参考 `example/PiDesktop`。它不只是 Pi RPC 连接示范，也包含接近 Codex Desktop 级别的完整桌面 agent 产品经验，尤其是 git、右侧边栏、终端、项目/会话组织、diff、文件区和主界面密度。
- Claude Code：延后。它是当前唯一需要重新找参考项目或官方连接方案的热门 agent。
- AionUi：继续作为 UI 组织、agent 管理、消息卡、权限/工具展示的优先参考，但不再照搬旧 Codex ACP 参数。

阶段目标是维护好三个高频 agent：Codex、Claude Code、Pi。WePChat 是个人维护项目，范围应克制，优先保证这三条链路稳定可用。

`PiDesktop` 的参考方式：

- 连接层：参考 `src/main/pi`、`example/acp-adapter/internal/pi`、`example/acp-adapter/testdata/fake_pi_rpc`。
- Codex RPC：参考 `example/acp-adapter/internal/codex` 以及其 app-server schema。
- Git / diff：参考 `src/main/git/GitService.ts` 和 renderer 侧 diff 展示。
- 右侧边栏：参考文件、终端、diff 的信息组织方式，但视觉落地仍要服从 WePChat 普通对话模式。
- 终端：参考 `src/main/terminal/TerminalSessionManager.ts` 与 `src/renderer/src/components/terminal/TerminalDock.tsx`。
- 项目/会话：参考 `src/main/projects/ProjectStore.ts` 和现有会话分页/加载逻辑。

## 5. 设置保留项

当前代码只保留设置层：

- `外部连接` 总开关。
- Codex / Claude Code / Pi 的启用状态。
- 本机命令检测。
- 可选 CLI 路径覆盖。
- settings JSON 中保留 `externalConnections`。

连接、会话、项目树、文件浏览、终端、diff、runtime manager、adapter 模板都等待新参考项目和详细计划后重新实现。
