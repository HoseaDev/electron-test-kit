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

**1. 添加依赖**（把本文件夹拷到项目里，或用相对路径引用）：

```jsonc
// package.json (devDependencies)
"@hoseadev/electron-test-kit": "file:../electron-test-kit",
"@playwright/test": "^1.60.0"
```

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

配套 `playwright.config.ts`（参考 FlowKit 的 `frontend/playwright.config.ts`）：`workers: 1`、`testMatch: /.*\.e2e\.ts$/`、超时 60s。

## API

| 函数 | 用途 |
|---|---|
| `launchElectron(options)` | 启动未打包构建产物；默认自动创建临时 userData 并在关闭时清理；返回 `{ app, window, mainLogs, userDataDir, close }`。可选 `executablePath` / `selectWindow` / `ready`（见下） |
| `expectMainWindowExists(app)` | 至少一个 BrowserWindow |
| `expectBridgeExposed(window, key)` | contextBridge key 已暴露（且非 null） |
| `expectNodeIntegrationDisabled(window)` | 渲染进程无 require/process/module/Buffer 泄漏。**仅探测这 4 个常见 Node 全局**，不等于证明 sandbox/contextIsolation 配置完全正确 |
| `expectMetaCspContains(window, { mustInclude, mustNotInclude })` | CSP `<meta>` 字符串满足包含/排除规则。**只做字符串包含检查**，不解析 CSP directive，也不看响应头 CSP |
| `callBridgeMethod(window, key, ['fs','readFile'], args, { timeout })` | 调 bridge 方法，throw 即失败；可选 `timeout` 防挂住的 IPC 拖垮整个测试 |
| `expectIpcRejected(window, key, path, args, { rejectIf, errorMatches, timeout })` | 断言 IPC 被拒绝（throw 或返回值满足谓词都算）；方法不存在会 fail，防拼写错误静默通过 |

> `expectStrictCSP` 是 `expectMetaCspContains` 的**废弃别名**，仍可用但请改用新名（下个大版本移除）。

### `launchElectron` 的三个可选钩子

- **`executablePath`**：显式指定 Electron 二进制；不传时从被测项目的 `node_modules` 解析。
- **`selectWindow(windows) => Page`**：多窗口 / splash 应用用它选主窗口；不传时用首个窗口。
- **`ready(window, app) => Promise<void>`**：自定义就绪判定；不传时只等 `domcontentloaded`。

```ts
const { app, window } = await launchElectron({
  entry: 'dist-electron/main/index.js',
  cwd: PROJECT_ROOT,
  selectWindow: (wins) => wins.find((w) => !w.url().includes('splash')) ?? wins[0],
  ready: async (win) => { await win.waitForSelector('#root') },
})
```

### 把安全断言钉死在预期错误上

`expectIpcRejected` 默认把**任何异常**都当"拒绝"。安全关键断言应传 `errorMatches`（匹配错误 message），否则一个内部 `TypeError` 会伪装成安全拒绝造成假绿。（只匹配 message——错误跨 contextBridge/IPC 边界时 `code` 等自定义属性通常被剥离。）

```ts
await expectIpcRejected(
  window, 'electronAPI', ['fs', 'readFile'], ['/etc/passwd'],
  { errorMatches: /denied|forbidden/ },  // 拒绝必须来自预期错误
)
```

## 约定

- **测的是未打包构建产物**，不是 dev server：先 `vite build`（FlowKit 用 `--mode=test`），再 `playwright test`。
- **每个测试自己 launch/close**，不共享 app 实例——串行慢一点，但故障隔离干净。`close()` 幂等，多次调用只真正关一次。
- `noSandbox` **默认 `false`**，由调用方显式开启（不再按平台/CI 静默开启，避免掩盖 sandbox 回归）。受限 CI 容器需要时自己传 `noSandbox: true`。
- **启动失败也会清理**：launch 之后任何一步（选窗口 / readiness）失败，kit 都会关闭进程并删除自动创建的临时 userData，不泄漏。
- CI 参考 FlowKit 的 `.github/workflows/e2e.yml`（Linux 需要 xvfb + Electron 依赖库）。

## 排障

| 症状 | 原因 |
|---|---|
| `Process failed to launch` | 正式应用正在运行抢了单实例锁（见接入第 2 步），或主进程入口未构建 |
| `主进程入口不存在` | 忘了先 build |
| 窗口拿不到 / 超时 | 主进程崩溃或 splash/多窗口未配 `selectWindow`。注意 `mainLogs` 常抓不到主进程 console（Playwright+Electron 下主进程 stdout 多走继承 fd 而非 pipe），排障优先看终端输出 |
| Linux/受限容器起不来 | 缺 xvfb 或系统库（见 FlowKit CI 的 apt-get 列表）；沙箱缺依赖时显式传 `noSandbox: true` |
