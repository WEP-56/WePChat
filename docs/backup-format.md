# WepChat 备份格式

更新时间：2026-07-10

## 文件格式

完整数据备份使用 `.wepchat` 扩展名，文件内容是标准 ZIP 容器。扩展名用于让用户和导入选择器明确区分 WepChat 备份与普通 JSON/ZIP 文件。

版本 1 包含两个 JSON 文件：

```text
manifest.json
data.json
```

Android 原生压缩可能在 ZIP 内增加一层目录，导入器按文件 basename 查找上述两个白名单文件，不依赖目录层级，也不会把压缩包解压到设备文件系统。

## manifest.json

```json
{
  "format": "wepchat-backup",
  "version": 1,
  "createdAt": "2026-07-10T00:00:00.000Z",
  "appVersion": "1.0.6"
}
```

- `format` 必须为 `wepchat-backup`；
- `version` 当前必须为数字 `1`；
- `createdAt` 是 ISO 8601 导出时间；
- `appVersion` 是导出时能读取到的应用版本。

## data.json

`data.json` 是 `Store.exportAll()` 的 JSON 结果，包含设置、模型提供商、会话及会话工作区数据。导入器读取后继续使用现有 `Store.importAll(data, 'merge')` 合并逻辑。

## 导入校验

- 文件名必须以 `.wepchat` 结尾；
- ZIP 必须同时包含 `manifest.json` 和 `data.json`；
- 只支持 ZIP store（method 0）和 deflate（method 8）；
- 校验每个读取文件的未压缩大小和 CRC32；
- ZIP 条目最多 1,000 个；
- 单个目标文件的压缩前后大小均不得超过 64 MB；
- 不支持的 manifest 版本会被拒绝，不应静默按旧结构导入。

旧版裸 `.json` 备份不再出现在文件选择器中，也不会被当前导入入口接受。如未来需要迁移旧备份，应提供明确的单独迁移流程，不要弱化 `.wepchat` 的格式校验。
