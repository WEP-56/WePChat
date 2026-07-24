# SQLite 存储改造计划

状态：**S1、S2 已实施**（2026-07-23，见文末实施记录）；S3 待做。本文是会话存储从「每会话一个 session.json」迁移到 SQLite 的实施依据。
配置（settings.json）**不迁移**，继续走 JSON——配置是低频、小体积、需要用户可读可手改的数据，JSON 是对的；会话是高频写、会增长、要索引和分页的数据，应该进库。

范围约定（已确认）：**不做老用户数据迁移**（既有 session.json 直接不再读取），**不考虑与安卓端的数据互通**。改造即全新启用，历史 JSON 会话不进库。

## 现状与问题

当前实现（`src-tauri/src/sessions.rs`）：

- 存储形态：`{workspaceRoot}/{sessionId}/session.json`，整会话（含全部消息、6 版本 variants、toolCalls、usage）序列化为一个 JSON 大对象。
- `list_sessions`：启动时**读取并完整解析每一个 session.json** 来构建侧栏列表。启动成本 = O(所有会话的全部消息)，会话越多越慢。
- `save_session`：每次持久化**整包重写**。而 `persistSession()`（`ui/js/app.js:1154`）在每个工具轮结束、每次流式收尾都会调用——大会话在一次生成里被完整序列化并写盘多次。
- 原子性缺口：`save_session` 先 `remove_file` 再 `rename`（Windows 上 rename 不能覆盖目标）。进程在 remove 与 rename 之间崩溃 → session.json 丢失。
- 无消息级读取能力：P2 的「历史消息分页加载」、全局搜索都只能在内存里全量做。
- 前端已有的保护要保留：`state.sessionSaveChains` 按会话串行化保存；`deletedSessionIds` 防删除后复写。

## 目标形态

### 库文件位置（决策点）

推荐：`{workspaceRoot}/wepchat.db`（而不是 appData）。

理由：现状语义是「工作区根目录 = 数据集」——用户自定义 root 后看到的是那个 root 下的会话集合，换 root 即换数据集。库跟着 root 走可以保留这个语义，且备份 = 拷贝一个目录（库 + 各会话工作区文件），数据不分家——会话的工作区文件（模型写的 HTML、生成图片）本来就必须留在文件系统。

代价：用户能直接看到/误删 db 文件——用 WAL + 启动完整性检查兜底（见「初始化与回退」）。

### Schema（`user_version = 1`）

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,          -- 现有 sessionId（[A-Za-z0-9_-]{1,96}）
  mode         TEXT NOT NULL DEFAULT 'chat',
  title        TEXT NOT NULL DEFAULT '',
  pinned       INTEGER NOT NULL DEFAULT 0,
  provider_id  TEXT NOT NULL DEFAULT '',
  model        TEXT NOT NULL DEFAULT '',
  meta_json    TEXT NOT NULL DEFAULT '{}', -- contextModel/contextWindow/contextVision/imageCanvas 等低频字段
  created_at   TEXT NOT NULL,              -- ISO 8601，与前端 nowIso() 一致
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC);

CREATE TABLE messages (
  id           TEXT PRIMARY KEY,          -- 现有 message id
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,          -- 会话内顺序，重排/截断时整体重写该会话的 seq
  role         TEXT NOT NULL,             -- user | assistant | tool
  content      TEXT NOT NULL DEFAULT '',  -- 独立列：给分页预览与 FTS 用
  payload_json TEXT NOT NULL DEFAULT '{}',-- reasoning/toolCalls/usage/variants/images/attachments/error/durationMs…
  created_at   TEXT NOT NULL,
  UNIQUE(session_id, seq)
);
CREATE INDEX idx_messages_session ON messages(session_id, seq);

-- S3 阶段可选：全局搜索
CREATE VIRTUAL TABLE messages_fts USING fts5(content, content='messages', content_rowid='rowid');
```

设计取舍：

- **不为 variants / toolCalls 建细表**。它们的更新模式是「随所属消息整体替换」，从不被单独查询；拆表只会把一次 upsert 变成一串 delete+insert。放 `payload_json`。
- **图片继续走文件系统**。消息里只存 `path`（现状如此，`persistSession` 落盘前已剥离 dataUrl），库里不进二进制。
- `content` 单列冗余是为了 sidebar 摘要、分页预览、FTS 三件事不用解析 payload。

### 命令面（兼容优先，两段切换）

阶段 S1 —— **Rust 内部换引擎，命令签名不变，前端零改动**：

| 命令 | 行为变化 |
| --- | --- |
| `list_sessions` | 轻查询：`SELECT` sessions 表 + 每会话最后一条消息的 content 前 200 字符做摘要；不再解析全部消息。返回结构补齐前端已消费的字段（messages 以空数组返回 + `messageCount`，见「前端配合」） |
| `load_session` | meta + `SELECT * FROM messages ORDER BY seq`，组装回现有 JSON 形状（含 workspacePath 注入） |
| `save_session` | 事务：upsert session 行 + 全量 delete/insert 该会话 messages（行为等价旧整包写，但原子） |
| `delete_session` | 事务删行（CASCADE）+ 删工作区目录（保持现状） |
| `copy_session` | 库内复制行，不再 load→save JSON |

阶段 S2 —— 消息级增量：

- 新增 `session_upsert_message(sessionId, seq, message, updatedAt)`：当前 S2 只写变更的助手消息行；后续如需一次提交多个 dirty 消息，可在此接口上扩展批量参数。
- 前端 `generateAssistant` 已知道本轮动过哪条消息（assistantMsg），把工具轮边界的「整包 clone + 全量保存」改为单条 dirty 消息写入；`sessionSaveChains` 串行化机制原样保留。
- 收益：流式期间每轮写量从 O(会话) 降到 O(1 条消息)。

阶段 S3 —— 建立在库上的功能：

- `session_messages_page(sessionId, beforeSeq, limit)` → P2「历史消息分页加载」的地基（配合 chat-scroll.js 的 prepend 保位）。
- 左侧会话标题搜索接入已有搜索框（先做轻量标题过滤）。
- FTS5 全局消息搜索延后。

### 前端配合（S1 内的最小改动）

`list_sessions` 不再返回全量 messages 后，两处消费点需要适配：

- `renderSessions()` / `sessionSummary()`：改用返回的 `summary` 字段（Rust 生成），不再从 `messages[]` 取。
- `openSession()` 的兜底分支（列表项当会话用）：改为必须 `load_session`；找不到就报「会话不存在」（现状的兜底本来就是降级路径）。

其余（normalizeSession、variants、branch 逻辑）不感知存储层。

## 初始化与回退

不做 JSON→DB 迁移：

1. 打开/创建 `{workspaceRoot}/wepchat.db`，按 `PRAGMA user_version` 建表；旧的 `{id}/session.json` 不再读取，`sessions.rs` 中的 JSON 读写路径直接删除。
2. 会话工作区目录仍按需创建（`{workspaceRoot}/{sessionId}/`），只是里面不再有 session.json。
3. 版本升级：后续 schema 变更走 `user_version` 递增 + 顺序迁移函数（`migrate_v1_v2()` …），禁止启动时 `DROP`。

**回退路径**：db 打开失败或 `PRAGMA integrity_check` 失败 → 重命名坏库为 `wepchat.db.corrupt-{ts}`，重建空库并 toast 告知用户。WAL/SHM 残留文件无害，SQLite 下次打开自动恢复。

## 并发与一致性

- rusqlite `Connection` 不是 Sync：用 `Mutex<Connection>` 全局单写连接（桌面单用户，足够；不引连接池）。WAL 模式下读不阻塞写。
- 一次持久化 = 一个事务（session meta + 消息行），崩溃后要么整体成功要么维持旧态——直接消除现有 remove/rename 窗口。
- 前端 `sessionSaveChains` 保序逻辑不动；后台会话流式保存与前台切换读取在 WAL 下天然并发。
- 进程退出：Tauri 退出钩子里 `PRAGMA wal_checkpoint(TRUNCATE)`，减少 wal 残留（残留也无害，下次打开自动恢复）。

## 依赖与体积

```toml
rusqlite = { version = "0.32", features = ["bundled"] }
```

bundled 静态编译 SQLite（约 +1MB 二进制），无系统依赖，无前端改动。

## 分阶段验收

- S1：启动时侧栏出现速度不随会话总量退化（100 会话 × 500 消息下 `list_sessions` < 50ms）；杀进程后无会话丢失；坏库重建路径演练一次通过。
- S2：长会话（>200 消息）流式期间单次持久化写入量为常数级；`sessionSaveChains` 语义不变（乱序保存不覆盖新数据）。
- S3：分页加载 50 条 < 10ms；前端 prepend 旧消息时保持滚动锚点；左侧标题搜索可用。

## 风险清单

- schema 演进纪律：所有变更必须走 user_version 迁移函数，禁止启动时 `DROP`。
- 超大单消息（长 toolCalls 结果）：payload_json 单行几 MB 属正常范围，SQLite 单行上限 1GB，无需分块。
- `valid_session_id` 校验保留——id 仍同时是目录名。
- 备份页（settings 里的 `.wepchat` 占位）后续若做，改为直接打包 `wepchat.db` + 工作区目录，不再承担跨端格式兼容。

## 实施记录

### 2026-07-23：S1 落地

- 新增 `src-tauri/src/db.rs`：连接按 workspaceRoot 缓存（`Mutex<Option<DbHandle>>`，换 root 关旧开新）；WAL + foreign_keys + synchronous=NORMAL；打开时 `quick_check`，失败把 `wepchat.db`（含 -wal/-shm）改名 `.corrupt-{ts}` 后重建；`PRAGMA user_version` 顺序迁移，schema v1 落地。
- `sessions.rs` 全量换引擎，命令签名不变：
  - `list_sessions` 轻查询（`messages` 恒为空数组），附 `summary`（首条用户消息首行，SQL 子查询取 content、Rust 截 64 字符）与 `messageCount`；
  - `load_session` 由列 + meta_json + messages（按 seq）组装回旧 JSON 形状，`workspacePath` 照旧注入；
  - `save_session` 单事务：sessions 行 upsert + 该会话 messages 全量替换；派生字段（messages/workspacePath/summary/messageCount）剥离不入库；会话内消息 id 重复时追加 `__dup{n}` 防御复合主键冲突；
  - `copy_session` 库内按行复制（messages 复合主键 `(session_id, id)` 允许跨会话同 id）；
  - `delete_session` 删行（CASCADE）+ 删工作区目录。
- 与计划的一处偏差：messages 主键从计划中的全局 `id TEXT PRIMARY KEY` 改为复合 `(session_id, id)`——否则 copy_session 复制行会主键冲突，重生成 id 又会破坏 variants 的 parent 链。
- 前端适配（`ui/js/app.js`）：`sessionTitle()` 增加 `summary` 回退；`sessionSummary()` 索引项携带 `summary`/`messageCount`；四处「拿不含消息的索引项当完整会话」的兜底全部安全化（openSession / ImageMode.loadSession 失败 toast 中止，loadBackend / deleteSessionById 失败改为新建会话），杜绝把有内容的会话当空会话覆盖保存。
- 依赖：`rusqlite = { version = "0.32", features = ["bundled"] }`。
- 验证:`cargo test` 往返单测（save→load→list→copy→resave→delete + 非法 id/不存在会话拒绝）通过；`cargo check`、`node --check` 通过。
- 行为提示：按约定不迁移旧数据——首次启动会话列表为空，旧 `{id}/session.json` 留在磁盘但不再读取。

### 2026-07-23：S2 落地

- 新增 `session_upsert_message` 命令：单事务更新会话 `updated_at` 并 upsert 一条消息；`seq` 冲突或会话不存在时返回错误。
- 前端统一通过 `queueSessionWrite` 保留 `sessionSaveChains` 的按会话串行语义；全量保存仍使用调用时快照。
- `generateAssistant` 在新助手消息首次全量落库后，两个工具轮边界改为只保存 `assistantMsg`；增量失败自动回退全量保存，生成收尾仍全量保存最终状态。
- 增量路径只 clone/剥离当前消息的图片数据；250 条消息的单测确认一次增量持久化固定为 1 次 session UPDATE + 1 次 message UPSERT。
- 验证：`cargo test`、`cargo check`、`node --check ui/js/app.js` 通过。

### 待办（S3）

- S3：`session_messages_page` 分页 + prepend 保位 + 左侧标题搜索；退出时 `wal_checkpoint(TRUNCATE)`。
- 延后：FTS5 全局消息搜索。
