# Changelog

版本遵循 semver：加断言 = minor，改签名 / 删函数 = major，修 bug / 文档 = patch。

## 0.2.0 — 2026-09-04

两个新能力都来自第一个真实消费者（FlowKit）暴露的问题，不是预设的功能列表。

- **新增 `expectWebPreferences(app, expected?)`**：主进程侧读每个 BrowserWindow 实际生效的 webPreferences，默认基线 `{ sandbox: true, contextIsolation: true, nodeIntegration: false }`。补上 `expectNodeIntegrationDisabled` 只是表层探测的缺口。fixture 新增 `insecure` 模式做负例。
- **`expectIpcRejected` 新增 `throwIsFailure` 选项**：按设计只返回值的通道，抛异常即失败，不再能伪装成安全拒绝。与 `errorMatches` 互斥。FlowKit 8 条安全测试里 7 条此前暴露在这个假绿路径下。
- templates：`_helpers.ts` 新增 `collectRendererErrors()`；`app.e2e.ts` 加入 webPreferences 断言和"首屏无报错"用例。
- DOCS 配方 3 改为等面板标志元素，不再示范 `waitForTimeout`；补充"未声明请求要断言"的提醒。

- 文档：安装方式改为 npm 优先（`pnpm add -D @hoseadev/electron-test-kit @playwright/test`），`file:` 引用降为"本地开发 kit 时用"。0.1.0 发布时 README 仍在教拷文件夹，会把新用户引到最慢的路。
- 新增 `templates/`：`playwright.config.ts`、`_helpers.ts`（含 splash / 多窗口 `selectWindow` 和 `ready` 示例）、`app.e2e.ts`、`ci.yml`，新项目拷四个文件即可接入。随包发布。
- 文档：修正 DOCS 与代码的漂移（清理机制的真实实现、CI 文件名、发布步骤、`selectWindow` 签名含 `app`）。
- 发版：`prepublishOnly` 追加 `npm test`，自测不过不能发。
- 自测：移除 fixture 里已删功能 `errorCode` 的残留。

## 0.1.0 — 2026-07-17

- 首次发布。`launchElectron` + 6 个断言原语，fixture 自测、单平台 CI、`npm pack` 消费者验证。
