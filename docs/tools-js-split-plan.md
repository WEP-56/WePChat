# `tools.js` 拆分计划

## 1. 目标

当前 `js/tools.js` 同时维护工具 schema、参数处理、执行路由、工作区公共函数、JavaScript 沙盒、网络请求和系统提示词。新增或修改一个工具往往需要在声明数组、执行 `switch` 和实现函数之间来回修改。

本轮将工具系统改为“注册表 + 独立工具模块”结构。每个工具自行管理 schema、参数校验和执行器；公共路径、文件限制等能力由共享层提供；应用继续使用原来的 `window.Tools` 接口。

`index.html` 的页面模板不拆分，本轮只调整底部普通 `<script>` 的加载顺序，保持 HBuilderX/H5 的无构建运行方式。

## 2. 兼容契约

以下现有接口保持不变：

- `Tools.DEFS`
- `Tools.SYSTEM_HINT`
- `Tools.execute(name, argsJson, ctx)`
- `Tools.runJS(...)`
- `Tools.runWorkspaceJS(...)`
- `Tools.applySandboxWrites(...)`
- `Tools.MAX_FILE`
- `Tools.MAX_FILES`
- `Tools.MAX_SERVICES`

工具名称、schema、执行结果文本、确认策略和持久化结构均不因本次拆分而主动改变。

## 3. 目标结构

```text
js/tools/
├─ registry.js             注册协议、统一参数解析与执行入口
├─ workspace.js            路径、文件夹、MIME、diff、服务等共享能力
├─ run-js.js               run_js schema、沙盒与工作区 JS 执行
├─ read-file.js            read_file
├─ write-file.js           write_file
├─ edit-file.js            edit_file
├─ delete-file.js          delete_file
├─ list-files.js           list_files
├─ create-folder.js        create_folder
├─ move-path.js            move_path
├─ path-exists.js          path_exists
├─ preview-file.js         preview_file
├─ web-fetch.js            web_fetch
├─ image-go.js             image_go 与历史别名 image_generation
├─ create-workspace.js     历史兼容工具 create_workspace
├─ run-service.js          历史兼容工具 run_service
├─ stop-service.js         历史兼容工具 stop_service
├─ list-services.js        历史兼容工具 list_services
└─ system-hint.js          跨工具公共行为提示

js/tools.js                兼容门面，组装 window.Tools
```

## 4. 注册协议

每个可执行工具调用共享注册表：

```js
WepChatTools.register({
  name: 'read_file',
  definition: {
    name: 'read_file',
    description: '...',
    parameters: { /* JSON Schema */ }
  },
  execute(args, ctx) {
    // 工具实现
  }
});
```

约束：

1. `name` 必须唯一，重复注册立即抛错，禁止静默覆盖；
2. 对模型公开的工具必须提供 `definition`；
3. 历史兼容工具可以只注册执行器，不进入 `Tools.DEFS`；
4. `registry.js` 统一解析 JSON 参数、解析 `{{prev.result}}` 和格式化错误；
5. 工具自己的授权与确认逻辑放在自身执行器中，例如 `web_fetch`；
6. 独立管理不等于复制公共代码，路径与工作区不变量统一由 `workspace.js` 提供。

## 5. 加载与装配顺序

```text
tools/registry.js
  -> tools/workspace.js
  -> 各独立工具文件
  -> tools/system-hint.js
  -> tools.js 兼容门面
  -> 其余 app 模块
```

所有文件继续通过普通 `<script>` 同步加载，不引入 ES Module、npm 打包器或异步动态加载。

## 6. 实施步骤

1. 建立带重复检测的注册表和共享常量；
2. 提取工作区共享能力；
3. 优先迁移 `run_js`、文件工具、预览、网络和图片工具；
4. 注册未公开但仍由旧执行入口支持的服务兼容工具；
5. 将 `tools.js` 收敛为兼容门面；
6. 更新 `index.html` 底部脚本顺序；
7. 对照拆分前后工具定义和执行路由。

## 7. 验收标准

- 每个公开工具的 schema 与拆分前深度一致；
- 公开工具名称及顺序保持一致；
- 兼容工具执行路由没有遗漏；
- `Tools` 的全部既有公共属性仍可用；
- 重复工具名注册会明确失败；
- 所有拆分文件低于 1,000 行并通过 `node --check`；
- 注册表装配测试、典型文件工具测试、JS 沙盒相关静态装配测试通过；
- 本地浏览器可以完成应用渲染且控制台无模块加载错误；
- 仓库现有检查和 `git diff --check` 通过。

## 8. 本轮不做

- 不拆分 `index.html` 页面模板；
- 不新增、删除或改名工具；
- 不修改工具权限默认值；
- 不重写 JS 沙盒安全模型；
- 不调整系统提示词内容，先保持行为兼容。

## 9. 实施结果

本计划已于 2026-07-10 完成实施。

- `js/tools.js` 已从 1,108 行收敛为兼容门面；
- 新增 19 个工具模块，最大文件 `run-js.js` 为 342 行；
- 12 个模型可见工具分别由独立文件维护；
- `image_generation` 别名和 4 个历史工作区/服务工具继续保留；
- 工具注册表会拒绝重复名称；
- `docs/tools.md` 已同步新的模块结构、注册协议、公开工具和兼容工具说明。

验证结果：

- 拆分前后 12 个公开 schema 深度一致，名称和顺序一致；
- 拆分前后 system hint 逐字一致；
- 17 个执行名称全部完成注册；
- 原 `Tools` 的 9 个公共属性全部保留；
- 写入、读取、编辑、移动、存在性检查、删除、`run_js`、历史服务工具、图片别名和网络禁用行为测试通过；
- 全部项目 JavaScript 文件通过 `node --check`；
- 本地浏览器完成 Vue 页面渲染，20 个工具相关脚本进入页面加载链，控制台无 error/warning；
- `npm --prefix .\wepchat-host run check` 与 `git diff --check` 通过。
