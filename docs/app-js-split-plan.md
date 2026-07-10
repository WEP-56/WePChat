# `app.js` 拆分计划

## 1. 背景与目标

当前 `js/app.js` 约 4,500 行，集中包含了以下职责：

- 应用启动与 Vue 挂载；
- 通用数据清洗、路径、版本、流式工具调用等辅助函数；
- Vue 的 `data`、`computed` 和生命周期；
- 应用设置、远程主机、会话、模型提供商、图片生成、远程对话、工作区、预览及数据管理等全部 methods。

本次拆分的首要目标是让任何新文件都不超过 1,000 行，同时保持现有 HBuilderX + Vue 全局脚本的运行方式，不引入 npm 打包、ES Module 转换或框架升级。

拆分完成后，`js/app.js` 只负责：

1. 等待存储层初始化；
2. 合并各领域 methods；
3. 创建并挂载 Vue 应用。

## 2. 拆分原则

1. **行为不变**：本轮只移动和装配代码，不重写业务逻辑，不改变界面、存储格式、API 请求和 HBuilderX 生命周期。
2. **依赖显式**：共享辅助函数统一从 `window.WepChatAppHelpers` 导出；各模块在文件顶部解构使用，避免新增散落的隐式全局变量。
3. **领域聚合**：Vue methods 按业务职责分组；跨领域协作继续通过 Vue 实例的 `this.xxx()` 完成。
4. **入口克制**：入口不承载业务实现，只负责初始化和装配。
5. **加载顺序稳定**：仍使用普通 `<script>`，共享模块和配置模块先加载，入口最后加载，兼容当前 Android WebView/H5 环境。
6. **可回退**：不改 Store 数据结构，不迁移用户数据；拆分差异主要是文件移动和脚本标签调整。

## 3. 目标文件结构

| 文件 | 主要职责 | 预计规模 |
| --- | --- | ---: |
| `js/app-helpers.js` | 会话规范化、文件/路径、版本、文本流、工具调用流等共享函数 | 约 520 行 |
| `js/app-options.js` | Vue `data`、`computed`、`mounted` | 约 600 行 |
| `js/app-methods-core.js` | Plus 生命周期、设置、更新、主题、模式、远程主机与远程工作区选择 | 约 900 行 |
| `js/app-methods-sessions.js` | 对话框、会话管理、导出、模型提供商、消息展示与编辑 | 约 620 行 |
| `js/app-methods-generation.js` | 请求设置、图片生成、远程事件/审批/消息、普通聊天生成 | 约 950 行 |
| `js/app-methods-workspace.js` | 输入与滚动、附件、工作区文件、查看器、浏览与导出、JS 运行 | 约 820 行 |
| `js/app-methods-preview.js` | 服务、预览、桥接消息、备份导入导出与清空数据 | 约 350 行 |
| `js/app.js` | Store 初始化、methods 合并、Vue 挂载 | 少于 40 行 |

methods 的边界以现有方法为单位切割，不拆开单个方法。若实际行数与预计有偏差，以“所有文件少于 1,000 行”和领域完整性为准。

## 4. 装配关系

加载顺序如下：

```text
现有基础模块（Store / API / Tools / Remote 等）
  -> app-helpers.js
  -> app-options.js
  -> app-methods-core.js
  -> app-methods-sessions.js
  -> app-methods-generation.js
  -> app-methods-workspace.js
  -> app-methods-preview.js
  -> app.js
```

装配约定：

- `app-helpers.js` 暴露 `window.WepChatAppHelpers`；
- `app-options.js` 暴露 `window.WepChatAppOptions`；
- 每个 methods 文件暴露一个仅包含本领域方法的对象；
- `app.js` 使用 `Object.assign` 合并 methods，再调用 `Vue.createApp(...).mount('#app')`；
- methods 名称必须唯一，避免后加载模块静默覆盖前一个同名方法。

## 5. 实施步骤

### 阶段 A：机械拆分

1. 提取 `createApp` 之前的辅助函数到 `app-helpers.js`；
2. 提取 `data`、`computed`、`mounted` 到 `app-options.js`；
3. 以完整方法为最小单位，将 `methods` 拆到五个领域文件；
4. 将 `app.js` 改为薄入口；
5. 在 `index.html` 中按依赖顺序增加脚本标签。

此阶段不调整方法实现、不改名、不改变参数与返回值。

### 阶段 B：静态验证

1. 对所有新 JavaScript 文件运行 `node --check`；
2. 统计文件行数，确保拆分文件均低于 1,000 行；
3. 检查所有原 methods 名称都被保留且只出现一次；
4. 检查 `index.html` 中脚本存在、顺序正确且没有重复加载；
5. 搜索未导出的共享函数引用和明显的装配缺失。

### 阶段 C：运行验证

在项目当前可用条件下执行已有构建或启动检查，重点验证：

- 首次打开与历史会话加载；
- 新建、切换、重命名和删除会话；
- 提供商设置与普通聊天发送；
- 图片生成入口；
- 远程 Host、工作区和线程恢复入口；
- 工作区文件查看、编辑、运行与预览；
- Android `plusready`、返回键、前后台持久化相关生命周期；
- 数据导入导出。

若仓库没有自动化测试或无法在命令行启动 HBuilderX Android 环境，则记录未能自动覆盖的手工验证项，不以猜测代替验证。

## 6. 验收标准

- `js/app.js` 少于 100 行，仅包含初始化和装配逻辑；
- 本次产生的每个 JavaScript 文件少于 1,000 行；
- 原 `app.js` 的辅助函数、Vue options 和 methods 没有遗漏；
- methods 不存在重名覆盖；
- 所有拆分文件通过 JavaScript 语法检查；
- 页面脚本加载顺序符合第 4 节；
- 不改变业务逻辑、持久化结构和外部 API 契约；
- 可执行的现有检查通过，无法自动验证的 Android/HBuilderX 项目列入交付说明。

## 7. 本轮范围之外

`js/tools.js` 与 `index.html` 也达到或略超 1,000 行，但它们不纳入本轮 `app.js` 机械拆分，以避免同时扩大回归面。完成并验证 `app.js` 后，再分别制定工具层领域拆分和页面模板拆分方案。

## 8. 实施结果

本计划已于 2026-07-10 完成实施。

| 文件 | 实际行数 |
| --- | ---: |
| `js/app-helpers.js` | 568 |
| `js/app-options.js` | 604 |
| `js/app-methods-core.js` | 889 |
| `js/app-methods-sessions.js` | 597 |
| `js/app-methods-generation.js` | 979 |
| `js/app-methods-workspace.js` | 791 |
| `js/app-methods-preview.js` | 358 |
| `js/app-methods-stability.js` | 52 |
| `js/app-methods-image-recovery.js` | 55 |
| `js/app.js` | 20 |

验证结果：

- 所有拆分文件均通过 `node --check`；
- 初次拆分前后 methods 均为 239 个，无遗漏或重名；后续稳定性与备份功能使当前 methods 增至 248 个；
- 隔离装配测试确认 Vue 收到 `data`、`computed`、`mounted` 和完整 methods，并挂载到 `#app`；
- 本地静态服务器真实浏览器检查通过，首页完成 Vue 渲染，8 个 app 脚本均按计划加载，控制台无 error/warning；
- `npm --prefix .\wepchat-host run check` 通过；
- `git diff --check` 通过。

尚需在 HBuilderX/Android 实机上回归 `plusready`、系统返回键、前后台切换、文件/相册/分享和通知等 `plus.*` 能力；普通浏览器不会提供这些原生接口。
