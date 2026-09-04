# @hoseadev/electron-test-kit

基于 Playwright 的 Electron e2e 测试原语。纯 ESM、零构建步骤。

> 📖 **完整手册见 [DOCS.md](./DOCS.md)** —— 核心概念、逐个 API 参考、mock 登录/全界面冒烟等配方、CI 集成、排障速查、以及开发篇（如何扩展这个包）。本 README 只讲上手。

## 支持范围（诚实边界）

支持用 Playwright 启动**未打包的 Electron main entry**（构建产物，如 `dist-electron/main/index.js`）做 e2e。**暂不承诺** asar、安装包、签名、自动更新、CJS 消费、多 Electron 版本兼容。

具体前提：

- **Node >= 20**
- **Playwright**：peer 区间 `>=1.40 <2`（不宣称兼容未来 2.x major）
- **ESM-only**：本包纯 ESM，无 CJS 构建，用 `import` 消费
- **测的是未打包产物**：先构建再跑，不测 dev server
- **Linux CI 需要 xvfb**（虚拟显示）+ 一组系统 GUI 库
- **profile 隔离需要应用支持 `--user-data-dir`**（见下方接入第 2 步）
- **多窗口 / splash 应用**必须自己传 `selectWindow`（选主窗口）和 `ready`（就绪判定），kit 默认只取首个窗口 + 等 `domcontentloaded`

## 接入（3 步）

**1. 添加依赖**（已发布到 npm）：

```bash
pnpm add -D @hoseadev/electron-test-kit @playwright/test
# npm i -D / yarn add -D 同理；playwright 由 @playwright/test 带入，不必单独装
```

> 只有在**本地开发 kit 本身**时才用 `"@hoseadev/electron-test-kit": "file:../electron-test-kit"`，且 pnpm 下改完 kit 要重新 `pnpm install` 才生效。

**2. 主进程支持 `--user-data-dir`**（隔离测试 profile 的关键，放在 `requestSingleInstanceLock()` 之前）：

```ts
// electron/main/index.ts，app.setName() 之后
const userDataDirOverride = app.commandLine.getSwitchValue('user-data-dir')
if (userDataDirOverride) {
  app.setPath('userData', userDataDirOverride)
  app.setPath('sessionData', userDataDirOverride)
}
```

没有这一步会发生两件坏事：a) 测试实例和你正开着的正式应用抢**单实例锁**，测试进程瞬间退出，Playwright 报 `Process failed to launch`；b) 测试共享正式 profile，上次的 token/localStorage 污染断言。

**3. 写测试**：

```ts
import { test, expect } from '@playwright/test'
import { launchElectron, expectNodeIntegrationDisabled } from '@hoseadev/electron-test-kit'

test('app boots', async () => {
  const { app, window } = await launchElectron({
    entry: 'dist-electron/main/index.js',  // 先构建再跑
    cwd: PROJECT_ROOT,
  })
  try {
    await expect(window).toHaveTitle(/MyApp/)
    await expectNodeIntegrationDisabled(window)
  } finally {
    await app.close()
  }
})
```

配套的 `playwright.config.ts`、项目本地 launch 封装、首个 e2e 文件和 CI workflow 都在 [`templates/`](./templates/) 里，拷四个文件即可（见下节）。

## 快速接入模板

`templates/` 目录是给新项目直接拷贝的起点，四个文件各自独立：

| 文件 | 拷到 | 作用 |
|---|---|---|
| `templates/playwright.config.ts` | 项目根 | 只跑 `*.e2e.ts`、串行、60s 超时 |
| `templates/_helpers.ts` | `test/e2e/` | 项目本地 `launchApp()` 封装（含 splash / 多窗口 `selectWindow`、`ready` 示例）+ `collectRendererErrors()` 渲染错误收集器 |
| `templates/app.e2e.ts` | `test/e2e/` | 启动冒烟 + 安全基线（webPreferences / bridge / Node 泄漏 / CSP）+ 首屏无报错 |
| `templates/ci.yml` | `.github/workflows/` | Linux runner 上的 xvfb + Electron 系统库 + 构建 + e2e |

装包后也能从 `node_modules/@hoseadev/electron-test-kit/templates/` 里拷。文件里标了 `TODO` 的地方（构建产物路径、bridge key、构建命令）按项目改。

## API

| 函数 | 用途 |
|---|---|
| `launchElectron(options)` | 启动未打包构建产物；默认自动创建临时 userData 并在关闭时清理；返回 `{ app, window, mainLogs, userDataDir, close }`。可选 `executablePath` / `selectWindow` / `ready`（见下） |
| `expectMainWindowExists(app)` | 至少一个 BrowserWindow |
| `expectBridgeExposed(window, key)` | contextBridge key 已暴露（且非 null） |
| `expectNodeIntegrationDisabled(window)` | 渲染进程无 require/process/module/Buffer 泄漏。**仅探测这 4 个常见 Node 全局**，是表层检查；严格验证用下一条 |
| `expectWebPreferences(app, expected?)` | 主进程侧读每个 BrowserWindow **实际生效**的 webPreferences。默认基线 `{ sandbox: true, contextIsolation: true, nodeIntegration: false }`，只比较列出的键 |
| `expectMetaCspContains(window, { mustInclude, mustNotInclude })` | CSP `<meta>` 字符串满足包含/排除规则。**只做字符串包含检查**，不解析 CSP directive，也不看响应头 CSP |
| `callBridgeMethod(window, key, ['fs','readFile'], args, { timeout })` | 调 bridge 方法，throw 即失败；可选 `timeout` 防挂住的 IPC 拖垮整个测试 |
| `expectIpcRejected(window, key, path, args, { rejectIf, errorMatches, throwIsFailure, timeout })` | 断言 IPC 被拒绝（throw 或返回值满足谓词都算）；方法不存在会 fail，防拼写错误静默通过。安全断言务必传 `errorMatches` 或 `throwIsFailure` 之一（见下） |

> `expectStrictCSP` 是 `expectMetaCspContains` 的**废弃别名**，仍可用但请改用新名（下个大版本移除）。

### `launchElectron` 的三个可选钩子

- **`executablePath`**：显式指定 Electron 二进制；不传时从被测项目的 `node_modules` 解析。
- **`selectWindow(windows, app) => Page`**：多窗口 / splash 应用用它选主窗口；不传时用首个窗口。第二参 `app` 可用 `app.waitForEvent('window')` 等稍后才打开的主窗。
- **`ready(window, app) => Promise<void>`**：自定义就绪判定；不传时只等 `domcontentloaded`。

```ts
const { app, window } = await launchElectron({
  entry: 'dist-electron/main/index.js',
  cwd: PROJECT_ROOT,
  selectWindow: (wins) => wins.find((w) => !w.url().includes('splash')) ?? wins[0],
  ready: async (win) => { await win.waitForSelector('#root') },
})
```

### 把安全断言钉死，别让内部 bug 伪装成拒绝

`expectIpcRejected` 默认把**任何异常**都当"拒绝"，这是向后兼容的宽松行为。安全关键断言按通道的拒绝方式二选一：

- **通道靠抛错拒绝** → 传 `errorMatches`，异常 message 必须匹配才算拒绝。（只匹配 message——错误跨 contextBridge/IPC 边界时 `code` 等自定义属性通常被剥离。）
- **通道靠返回值拒绝**（如返回 `{ success: false }` 或 `false`，按设计从不抛错）→ 传 `throwIsFailure: true` + `rejectIf`，任何异常都算失败。

```ts
// 抛错型通道
await expectIpcRejected(
  window, 'electronAPI', ['app', 'getPath'], ['home'],
  { errorMatches: /not allowed/ },
)
// 返回值型通道：抛了异常说明实现有 bug，不能算"拒绝成功"
await expectIpcRejected(
  window, 'electronAPI', ['fs', 'readFile'], ['/etc/passwd'],
  { throwIsFailure: true, rejectIf: (r) => (r as any)?.success === false },
)
```

两个选项互斥，同时传会报用法错误。

## 约定

- **测的是未打包构建产物**，不是 dev server：先构建（如 `vite build --mode=test`），再 `playwright test`。
- **每个测试自己 launch/close**，不共享 app 实例——串行慢一点，但故障隔离干净。`close()` 幂等，多次调用只真正关一次。
- `noSandbox` **默认 `false`**，由调用方显式开启（不再按平台/CI 静默开启，避免掩盖 sandbox 回归）。受限 CI 容器需要时自己传 `noSandbox: true`。
- **启动失败也会清理**：launch 之后任何一步（选窗口 / readiness）失败，kit 都会关闭进程并删除自动创建的临时 userData，不泄漏。
- CI 直接拷 [`templates/ci.yml`](./templates/ci.yml)（Linux 需要 xvfb + Electron 依赖库，列表已在里面）。

## 排障

| 症状 | 原因 |
|---|---|
| `Process failed to launch` | 正式应用正在运行抢了单实例锁（见接入第 2 步），或主进程入口未构建 |
| `主进程入口不存在` | 忘了先 build |
| 窗口拿不到 / 超时 | 主进程崩溃或 splash/多窗口未配 `selectWindow`。注意 `mainLogs` 常抓不到主进程 console（Playwright+Electron 下主进程 stdout 多走继承 fd 而非 pipe），排障优先看终端输出 |
| Linux/受限容器起不来 | 缺 xvfb 或系统库（见 `templates/ci.yml` 的 apt-get 列表）；沙箱缺依赖时显式传 `noSandbox: true` |
