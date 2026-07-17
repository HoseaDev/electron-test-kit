# electron-test-kit 完整手册

Playwright 驱动的 Electron 应用 e2e 测试工具包。这份文档分两部分：**使用篇**（怎么用它测你的应用）和**开发篇**（怎么扩展/维护这个包本身）。

如果你只想快速跑起来，先看 [README.md](./README.md) 的三步上手；这里是需要深入时的完整参考。

---

## 目录

**使用篇**
1. [这是什么·心智模型](#1-这是什么心智模型)
2. [前置条件](#2-前置条件)
3. [安装（三种方式）](#3-安装三种方式)
4. [必须理解的 4 个核心概念](#4-必须理解的-4-个核心概念)
5. [API 参考](#5-api-参考)
6. [常用配方](#6-常用配方)
7. [配置 playwright.config.ts](#7-配置-playwrightconfigts)
8. [CI 集成](#8-ci-集成)
9. [排障速查表](#9-排障速查表)

**开发篇**
10. [包结构与内部原理](#10-包结构与内部原理)
11. [如何新增一个断言](#11-如何新增一个断言)
12. [为什么是纯 JS + 手写 d.ts](#12-为什么是纯-js--手写-dts)
13. [自测与发布](#13-自测与发布)
14. [FAQ](#14-faq)

---

# 使用篇

## 1. 这是什么·心智模型

一句话：**它帮你用 Playwright 启动"已经构建好的" Electron 应用，拿到一个可以断言的窗口对象，并附带一套 Electron 专用的安全断言。**

### 支持范围（诚实边界，勿夸大）

支持用 Playwright 启动**未打包的 Electron main entry**（构建产物）做 e2e。**暂不承诺** asar、安装包、签名、自动更新、CJS 消费、多 Electron 版本兼容。这些要等有真实外部消费者后逐项补齐，现在不宣称"任何 Electron 应用通用"。

### 要解决的痛点

直接用 Playwright 测 Electron 有几个反复踩的坑，这个包把它们一次性封好：

- **抢单实例锁**：你本机开着应用时，测试实例启动即被踢掉，报 `Process failed to launch`
- **测试间污染**：上一个测试登录后的 token/localStorage 残留，下一个测试直接跳过登录页
- **临时目录清理**：每个测试用独立 profile，跑完要清理，手写很啰嗦
- **Node 二进制路径解析**：`electron.launch` 需要可执行文件路径，跨项目/CI 容易错
- **安全断言重复造轮子**：CSP 严格性、IPC 拒绝、Node 泄漏检测，每个项目都要写

### 它做什么 / 不做什么

| 做 | 不做 |
|---|---|
| 启动构建产物、隔离 profile、清理 | 帮你构建应用（你自己先 `vite build`） |
| 提供 launch + 安全断言原语 | 提供业务断言（登录、下单——那是你项目的事） |
| 收集主进程日志用于排障 | 内置 mock（mock 是 Playwright 能力，配方里教你写） |

### 和单元测试的分工

```
单元测试 (Vitest)          这个包 (Playwright + Electron)
─────────────────          ────────────────────────────
纯函数、算法、组件逻辑        真实进程、真实 IPC、真实 CSP
毫秒级、无窗口               秒级、弹真窗口
测"逻辑对不对"              测"应用装起来能不能跑、安全防线在不在"
```

两者互补，不是替代关系。能用单测覆盖的逻辑就别放到 e2e（慢且脆）。e2e 留给：**启动冒烟、安全回归、跨进程的关键用户旅程。**

---

## 2. 前置条件

- **Node >= 20**
- **纯 ESM** 消费：本包无 CJS 构建，用 `import` 引用（不能 `require`）
- 你的项目是 **Electron 应用**，且能构建出**未打包**的主进程入口文件（如 `dist-electron/main/index.js`）
- 安装了 `@playwright/test` 和 `playwright`（本包的 peer 依赖，支持区间 `>=1.40 <2`）
- 主进程支持 `--user-data-dir` 开关（见[核心概念](#4-必须理解的-4-个核心概念)，一段代码的事）——profile 隔离依赖它
- **Linux CI 需要 xvfb**（虚拟显示）+ 一组系统 GUI 库（见 [§8](#8-ci-集成)）
- **多窗口 / splash 应用**需自己传 `selectWindow` 和 `ready`（见 [§5](#5-api-参考)），kit 默认只取首个窗口

> **关键认知**：这个包测的是**未打包构建产物**，不是 Vite dev server，也不是 asar / 安装包。跑 e2e 前必须先构建。

---

## 3. 安装（三种方式）

按"给谁用"选一种。

### 方式 A：同仓库 / 同机多项目（`file:` 依赖）

最简单，FlowKit 现在就是这么用的。把 `electron-test-kit/` 放在能被相对路径引用到的地方：

```jsonc
// 你项目的 package.json → devDependencies
"@hoseadev/electron-test-kit": "file:../electron-test-kit",
"@playwright/test": "^1.60.0"
```

```bash
pnpm install
```

**注意包管理器差异**：pnpm 的 `file:` 依赖是**安装期拷贝**（软链到 `.pnpm` 下的一份副本），改了 kit 源码必须 `pnpm install` 才生效；npm/yarn 的 `file:` 多为真软链，改完直接生效。跨包管理器最稳的做法是：**改完 kit 一律 `pnpm install` 一次再跑测试**。

### 方式 B：团队共享（Git 依赖）

把 `electron-test-kit/` 推到一个 Git 仓库，然后：

```jsonc
"@hoseadev/electron-test-kit": "git+https://your-git-host/electron-test-kit.git#v0.1.0"
```

免搭 npm registry，适合公司内网共享。用 tag 锁版本。

### 方式 C：对外发布（npm）

见[开发篇 §13](#13-自测与发布)。发布后就是普通 `pnpm add -D @hoseadev/electron-test-kit`。

---

## 4. 必须理解的 4 个核心概念

这 4 点理解了，90% 的问题不会发生。

### ① 测的是构建产物，不是 dev server

`launchElectron({ entry })` 的 `entry` 指向**构建后**的主进程文件。所以工作流永远是"先构建，再测"：

```bash
vite build --mode=test   # 产出 dist/ + dist-electron/
playwright test          # 再测
```

好处：测的就是用户拿到手的东西，不受 dev server 热更新、source map 等干扰。

### ② 每个测试自己 launch / close

不要全局共享一个 app 实例。每个 `test()` 内部 `launchElectron()`，`finally` 里 `app.close()`：

```ts
test('xxx', async () => {
  const { app, window } = await launchElectron({ entry, cwd })
  try {
    // 断言
  } finally {
    await app.close()   // 必须，否则进程泄漏
  }
})
```

串行会慢一点，但**故障隔离干净**——一个测试崩了不会污染其他测试。这是刻意的取舍。

### ③ userData 隔离 + 单实例锁

`launchElectron` 默认（`isolateUserData: true`）为每次启动创建一个临时 userData 目录，关闭时自动删除。这同时解决两件事：

- **profile 干净**：没有上次的 token/缓存/localStorage
- **不抢单实例锁**：Electron 的单实例锁按 userData 目录计算，独立目录 = 独立锁，测试实例不会和你正开着的正式应用打架

**前提**：你的主进程必须支持 `--user-data-dir`。在 `app.requestSingleInstanceLock()` **之前**加这段：

```ts
// electron/main/index.ts
const userDataDirOverride = app.commandLine.getSwitchValue('user-data-dir')
if (userDataDirOverride) {
  app.setPath('userData', userDataDirOverride)
  app.setPath('sessionData', userDataDirOverride)
}
```

为什么必须在锁之前：锁是按 userData 算的，如果先拿锁再改目录，锁已经用错目录拿过了，隔离失效。

### ④ noSandbox 由调用方显式开启

`noSandbox` **默认 `false`**，kit 不再按平台/CI 静默加 `--no-sandbox`。原因：静默降级会掩盖 sandbox 回归（比如误关了沙箱也照样绿）。受限 CI 容器里 Electron 沙箱缺依赖起不来时，**由你显式传** `noSandbox: true`：

```ts
await launchElectron({ entry, cwd, noSandbox: process.env.CI === 'true' })
```

本地 macOS/Windows 一般不需要。

---

## 5. API 参考

包导出 7 个函数：1 个启动器 + 6 个断言/调用原语（外加一个废弃别名 `expectStrictCSP`）。全部是 async。

### `launchElectron(options)`

启动**未打包**的 Electron 构建产物。

**参数** `options`：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `entry` | string | **必填** | 主进程入口（构建产物），相对 `cwd` 或绝对路径 |
| `cwd` | string | `process.cwd()` | 应用项目根目录 |
| `env` | object | `{}` | 附加环境变量，合并进 `process.env` |
| `args` | string[] | `[]` | 附加命令行参数 |
| `isolateUserData` | boolean | `true` | 临时 userData 隔离 + 自动清理（需主进程支持 `--user-data-dir`） |
| `noSandbox` | boolean | `false` | 是否加 `--no-sandbox`。**默认关**，受限容器需要时由调用方显式开启（见[核心概念④](#4-必须理解的-4-个核心概念)） |
| `recordMainProcessLogs` | boolean | `false` | 尽力收集 `app.process()` 的 stdout/stderr 到 `mainLogs`。**注意**：Playwright+Electron 下主进程 console 输出多走继承 fd 而非 pipe，常抓不到——best-effort，勿依赖 |
| `firstWindowTimeout` | number | `30000` | 等首个窗口的超时（毫秒） |
| `executablePath` | string | 从 `cwd` 项目解析 | 显式指定 Electron 二进制路径 |
| `selectWindow` | `(windows: Page[]) => Page \| Promise<Page>` | 取首个窗口 | 多窗口 / splash 应用选主窗口 |
| `ready` | `(window: Page, app) => Promise<void>` | 等 `domcontentloaded` | 自定义就绪判定 |

**返回** `Promise<LaunchedApp>`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `app` | `ElectronApplication` | Playwright 的 Electron app 句柄 |
| `window` | `Page` | 选中的窗口，已过 readiness（默认首个窗口 + `domcontentloaded`） |
| `mainLogs` | string[] | best-effort 诊断：kit 清理失败信息 + `app.process()` stdio（后者常为空，见上） |
| `userDataDir` | string \| null | 本次隔离用的临时目录，未隔离时为 `null` |
| `close` | `() => Promise<void>` | 关闭 app，**幂等**：多次调用只真正关一次 |

```ts
const { app, window, mainLogs } = await launchElectron({
  entry: 'dist-electron/main/index.js',
  cwd: PROJECT_ROOT,
  env: { NODE_ENV: 'test' },
  recordMainProcessLogs: true,
})
```

> 若显式在 `args` 里传了 `--user-data-dir`，kit 尊重你的，不再自动隔离。

**生命周期保证**：`electron.launch()` 之后任何一步（选窗口 / readiness）失败，kit 都会关闭已启动的进程并删除自动创建的临时 userData，**启动失败也会清理**，不泄漏进程或目录。

**`executablePath`**：不传时用 `createRequire` 从被测项目的 `node_modules` 解析 Electron 二进制。跨项目/多版本场景可显式覆盖。

**`selectWindow`**：kit 默认取 `app.firstWindow()`。有 splash 窗口或多窗口时，用它从 `app.windows()` 里挑真正的主窗口：

```ts
selectWindow: (wins) => wins.find((w) => !w.url().includes('splash')) ?? wins[0]
```

**`ready`**：kit 默认只等 `domcontentloaded`。若"页面加载完"不等于"应用就绪"（如要等某个根节点渲染），用它自定义：

```ts
ready: async (win) => { await win.waitForSelector('#root', { timeout: 15_000 }) }
```

### `expectMainWindowExists(app)`

断言 app 至少有一个 `BrowserWindow`。

```ts
await expectMainWindowExists(app)
```

### `expectBridgeExposed(window, bridgeKey)`

断言 contextBridge 暴露了指定 key（且是对象）。`bridgeKey` 是你 preload 里 `contextBridge.exposeInMainWorld('xxx', ...)` 的那个 `'xxx'`。

```ts
await expectBridgeExposed(window, 'electronAPI')
```

### `expectNodeIntegrationDisabled(window)`

断言渲染进程没有泄漏 Node 全局（`require`/`process`/`module`/`Buffer`）。

```ts
await expectNodeIntegrationDisabled(window)
```

> **诚实边界**：这是一个**表层探测**，只检查这 4 个常见 Node 全局，**不等于**证明了 `sandbox` / `contextIsolation` 配置完全正确。要严格验证隔离配置，应在主进程侧断言 `webPreferences`。

### `expectMetaCspContains(window, rules?)`

断言页面的 CSP `<meta>` 存在且满足包含/排除规则。

```ts
await expectMetaCspContains(window, {
  mustInclude: ["default-src 'self'", "object-src 'none'"],
  mustNotInclude: ["'unsafe-eval'"],
})
```

> **诚实边界**：这是**字符串包含检查**，不解析 CSP directive，也不检查响应头 CSP。够用于回归"某条 directive 还在/没被加回来"，但不是完整的 CSP 校验器。
>
> 旧名 `expectStrictCSP` 是本函数的**废弃别名**，仍可用但请改用 `expectMetaCspContains`（下个大版本移除）。

### `callBridgeMethod(window, bridgeKey, methodPath, args?, options?)`

在渲染进程里调用 bridge 方法并返回结果。`methodPath` 是嵌套路径数组。方法不存在或抛异常时 **throw**。可选 `options.timeout`（毫秒）：挂住的 IPC 到点即抛，不再拖到整个测试超时。

```ts
// 调用 window.electronAPI.app.getPath('downloads')
const dir = await callBridgeMethod<string>(
  window, 'electronAPI', ['app', 'getPath'], ['downloads'], { timeout: 5_000 },
)
```

### `expectIpcRejected(window, bridgeKey, methodPath, args, options?)`

断言某个 IPC/bridge 调用被**拒绝**。判定顺序：

1. **方法不存在** → 直接 fail（防拼错静默通过）。
2. **调用抛异常**：
   - 给了 `errorMatches`（子串或正则，匹配错误 message）时，异常**必须匹配**才算拒绝；
   - 没给时，任何异常都算拒绝（向后兼容）。
3. **调用返回值**：由 `rejectIf` 谓词判定（如 `{success:false}` 或 `false`）；没给 `rejectIf` 则 fail。

可选 `options.timeout` 同 `callBridgeMethod`。

> **安全关键断言应传 `errorMatches`**，把拒绝钉死在预期错误消息上。否则一个内部 `TypeError`（比如你把方法调错了）会伪装成"安全拒绝"造成假绿。只匹配 message——错误跨 contextBridge/IPC 边界时 `code` 等自定义属性通常被剥离，只有 name/message 可靠存活，所以本包不提供 errorCode 匹配。

```ts
// 断言读 /etc/passwd 被拒,且拒绝来自预期错误(而非内部 bug)
await expectIpcRejected(
  window, 'electronAPI', ['fs', 'readFile'], ['/etc/passwd'],
  {
    errorMatches: /denied|forbidden|not allowed/,
    // 或按返回值判定: rejectIf: (r) => (r as any)?.success === false,
    message: 'reading /etc/passwd should be denied',
  },
)
```

**注意**：如果方法压根不存在，这个断言会 **fail**（而不是当成"拒绝"）——防止你把方法名拼错却误以为测试通过了。要断言"某通道已被移除"，请单独用 `window.evaluate` 检查它不存在。

---

## 6. 常用配方

这些不是 kit 的 API，而是**你在项目里写的**基于 kit 的封装。建议放在项目的 `test/e2e/_helpers.ts`。

> **注意**：下面的 mock 登录、遍历面板、后端探测、中文 label 选择器等都是 **FlowKit 项目本地配方，不是框架通用能力**。kit 只提供 launch + 安全断言原语；登录/API mock/Redis/业务 selector 这类东西**留在你自己的项目里**，不进 kit。这里列出来只是给同类项目参考写法。

### 配方 1：项目本地 launch 封装

把入口路径、环境变量固定下来，测试里少写参数：

```ts
// test/e2e/_helpers.ts
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchElectron, type LaunchedApp } from '@hoseadev/electron-test-kit'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')

export function launchApp(): Promise<LaunchedApp> {
  return launchElectron({
    entry: path.join(ROOT, 'dist-electron', 'main', 'index.js'),
    cwd: ROOT,
    env: { NODE_ENV: 'test' },
    recordMainProcessLogs: true,
  })
}
```

### 配方 2：mock 登录（不需要真实账号 / 不需要起后端）

用 Playwright 的网络拦截伪造后端响应，再种入假 token 让应用进入已登录态。**这是"不用给测试真实账号"的关键。**

```ts
import type { Page } from '@playwright/test'

// 拦截所有 API,/users/me 返回假用户,其余返回空成功
export async function mockApi(window: Page) {
  await window.route('**/api/v1/**', (route) => {
    const pathname = new URL(route.request().url()).pathname
    const ok = (data: unknown) => route.fulfill({ json: { code: 0, message: 'ok', data } })
    if (pathname.endsWith('/users/me')) {
      return ok({ id: 1, username: 'e2e-user', vip_level: 3, permissions: [], /* ... */ })
    }
    return ok(null)
  })
}

export async function launchLoggedIn(): Promise<LaunchedApp> {
  const handle = await launchApp()
  await mockApi(handle.window)
  // 种入假 token(key 要和你项目 storage 一致)
  await handle.window.evaluate(() => {
    localStorage.setItem('app_access_token', 'fake')
    localStorage.setItem('app_refresh_token', 'fake')
  })
  await handle.window.reload()  // 让启动流程带着 token + mock 重新走
  // 等一个"已登录"的标志元素出现
  await handle.window.getByPlaceholder('搜索...').waitFor({ state: 'visible' })
  return handle
}
```

原理：应用启动时检测到 token → 调 `/users/me` → mock 返回假用户 → 进入主界面。全程不碰真实后端。

### 配方 3：遍历所有界面冒烟（数据驱动）

如果你的应用有"注册表 + 一堆面板"的结构，可以从真实 DOM 收集所有条目，逐个打开断言不崩。给每个可点条目加一个 `data-testid`，测试就能自动覆盖新增项：

```ts
test('every panel renders without errors', async () => {
  const { app, window } = await launchLoggedIn()
  // 禁用 CSS 动画,避免 animate-in 中间帧导致的判定抖动
  await window.addStyleTag({ content: '*{transition:none!important;animation:none!important}' })

  const errors: string[] = []
  window.on('pageerror', (e) => errors.push(e.message))
  window.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

  const ids: string[] = await window.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="item-"]')]
      .map((el) => el.getAttribute('data-testid')!.replace('item-', '')))

  const failures: Record<string, string[]> = {}
  try {
    for (const id of ids) {
      errors.length = 0
      await window.locator(`[data-testid="item-${id}"]`).click()
      await window.waitForTimeout(150)
      if (errors.length) failures[id] = [...errors]
    }
    expect(failures).toEqual({})   // 空 = 所有面板都干净
  } finally {
    await app.close()
  }
})
```

> FlowKit 用这个模式一次抓到了一个真实崩溃（某工具的空 `<SelectItem value="">` 导致白屏）。数据驱动的价值就在这——新增条目零成本纳入覆盖。

### 配方 4：安全回归

每条对应一个修过的漏洞，在真实应用里模拟攻击并断言被拒。参考 [§5 的 `expectIpcRejected`](#expectipcrejectedwindow-bridgekey-methodpath-args-options)。

### 配方 5：依赖后端的测试优雅跳过

有些测试确实需要真后端。没起后端时让它 skip 而不是 fail，这样 `pnpm test:e2e` 在任何机器都能整体绿：

```ts
async function backendUp(): Promise<boolean> {
  try { await fetch('http://127.0.0.1:12702', { signal: AbortSignal.timeout(1500) }); return true }
  catch { return false }
}

test.beforeEach(async () => {
  test.skip(!(await backendUp()), '后端未运行,跳过')
})
```

### 配方 6：主进程崩溃排障

窗口拿不到、启动超时，八成是主进程崩了。`mainLogs` 可以 best-effort 看一眼，但
**Playwright+Electron 下主进程 console 常抓不到**（走继承 fd 而非 pipe），所以更
可靠的是直接看**跑测试的终端输出**（主进程 stdout/stderr 通常继承到那里）。

```ts
const { window, mainLogs } = await launchApp()
try {
  await window.waitForSelector('#root')
} catch (e) {
  console.log('主进程日志(可能为空):\n' + mainLogs.join('')) // 空就去看终端
  throw e
}
```

---

## 7. 配置 playwright.config.ts

关键点：只跑 `*.e2e.ts`、串行（`workers: 1`）、给足超时。

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  testMatch: /.*\.e2e\.ts$/,
  timeout: 60_000,          // Electron 启动慢
  expect: { timeout: 10_000 },
  fullyParallel: false,     // Electron 启停有时序成本,并发易冲突
  workers: 1,
  retries: 0,
  reporter: [['list']],
})
```

配套 `package.json` 脚本：

```jsonc
"scripts": {
  "test:e2e:build": "vite build --mode=test",
  "test:e2e": "playwright test",
  "test:e2e:full": "vite build --mode=test && playwright test"
}
```

---

## 8. CI 集成

Linux runner 上跑 Electron 需要 xvfb（虚拟显示）+ 一堆系统库。GitHub Actions 示例：

```yaml
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - run: pnpm install --frozen-lockfile   # 需要提交 lockfile!
      - name: Install xvfb + Electron deps
        run: |
          sudo apt-get update
          sudo apt-get install -y xvfb libnss3 libatk1.0-0 libatk-bridge2.0-0 \
            libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
            libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64 libgtk-3-0
      - run: pnpm test:e2e:build
      - name: Run e2e
        run: xvfb-run -a pnpm exec playwright test test/e2e/app.e2e.ts test/e2e/security.e2e.ts
      - if: failure()
        uses: actions/upload-artifact@v4
        with: { name: playwright-results, path: test-results/ }
```

两个 CI 常见坑：

- **lockfile 必须提交**。`--frozen-lockfile` 找不到 lockfile 直接失败。
- **Electron 自带 Chromium**，不需要 `npx playwright install`；缺的是系统 GUI 库，用 apt 装。

---

## 9. 排障速查表

| 症状 | 原因 / 解法 |
|---|---|
| `Process failed to launch` | ①本机开着应用抢了单实例锁 → 确认主进程支持 `--user-data-dir`（[核心概念③](#4-必须理解的-4-个核心概念)）；②入口未构建 → 先 build |
| `主进程入口不存在: ...` | 忘了 `vite build`，或 `entry` 路径写错 |
| 窗口拿不到 / `firstWindow` 超时 | 主进程崩溃 → 开 `recordMainProcessLogs` 看 `mainLogs` |
| 测试停在登录页 | **正常**（隔离后没有 token）。要进主界面用 mock 登录（[配方 2](#配方-2mock-登录不需要真实账号--不需要起后端)） |
| `require is not defined`（渲染层） | 构建把 Node 模块打进了渲染层。检查是否误用了 `nodeIntegration` shim 类插件 |
| 遍历点击 flaky、元素找不到 | CSS 动画中间帧作祟 → `addStyleTag` 禁用 animation/transition（[配方 3](#配方-3遍历所有界面冒烟数据驱动)） |
| Linux/CI 上崩 | 缺 xvfb 或系统库 → 见 [§8](#8-ci-集成) 的 apt 列表 |
| `expectIpcRejected` 意外通过 | 方法名拼错了 → kit 对"方法不存在"会 fail，检查 `methodPath` |
| 端口/后端相关失败 | 该测试依赖真后端 → 用 backend 探测跳过（[配方 5](#配方-5依赖后端的测试优雅跳过)） |

---

# 开发篇

面向要**扩展或维护这个包本身**的人。

## 10. 包结构与内部原理

```
electron-test-kit/
├── index.js       # 全部实现(纯 ESM JavaScript)
├── index.d.ts     # 手写类型声明
├── package.json   # exports 映射 + peerDependencies
├── README.md      # 5 分钟上手
└── DOCS.md        # 本文件
```

### `launchElectron` 内部做了什么

按顺序：

1. **解析 electron 二进制**：不传 `executablePath` 时，用 `createRequire(cwd/package.json)` 从**被测项目**的 node_modules 解析 electron 可执行文件路径（不是从 kit 自己的）。这样 kit 不需要依赖 electron。
2. **校验入口存在**：`entry` 不存在直接抛人话错误（"先构建"），避免 Playwright 抛难懂的底层错。
3. **组装参数**：若开启隔离且调用方没自带 `--user-data-dir`，`mkdtempSync` 建临时目录并加进 args；仅当 `noSandbox: true` 时加 `--no-sandbox`（默认不加）。
4. **launch**：`electron.launch({ executablePath, args, cwd, env })`。launch 本身失败时清理临时目录再抛。
5. **注册清理**：`app.on('close')` 里 `rmSync` 临时目录（正常路径由调用方 `close` 触发）；清理失败写进 `mainLogs` 不完全静默。
6. **可选收集日志**：`app.process().stdout/stderr` 的 data 事件推进 `mainLogs`。
7. **选窗口 + 等就绪**：有 `selectWindow` 则先 `firstWindow` 确保有窗口再交给它挑，否则用 `firstWindow`；有 `ready` 则调它，否则 `waitForLoadState('domcontentloaded')`。**这步失败会 `close()` 进程 + 删临时目录，绝不泄漏。**

`close()` 用一个 `closed` 标志实现幂等，调多次只真正关一次。真实的清理保证是：**正常关闭时删目录，且启动过程任一步失败也删目录**——不是"无论测试怎么退出都自动清理"（进程被强杀等极端情况仍可能残留临时目录，由 OS tmp 回收）。

### 断言原语的实现套路

- 纯"读状态"的断言（CSP、bridge 暴露、Node 泄漏）走 `window.evaluate` 在渲染进程里取值，再用 Playwright 的 `expect` 判断。
- IPC 类（`callBridgeMethod` / `expectIpcRejected`）共用一个内部 `invokeBridge`：在渲染进程里按 `methodPath` 逐级取到函数并调用，**捕获异常**，返回结构化的 `{threw, notFound, error, result}`，再由外层决定语义。这样"抛异常"和"返回失败值"两种拒绝形态能统一处理。

## 11. 如何新增一个断言

以"断言窗口标题匹配某正则"为例（虽然 Playwright 自带，仅作示范）。

**第一步**：在 `index.js` 加实现，风格和现有断言一致（async、用 `expect`、带可读消息）：

```js
/**
 * 断言窗口标题匹配。
 * @param {import('playwright').Page} window
 * @param {RegExp} pattern
 */
export async function expectTitleMatches(window, pattern) {
  const title = await window.title()
  expect(title, `窗口标题 "${title}" 应匹配 ${pattern}`).toMatch(pattern)
}
```

**第二步**：在 `index.d.ts` 加类型：

```ts
export declare function expectTitleMatches(window: Page, pattern: RegExp): Promise<void>
```

**第三步**：在 `README.md` 的 API 表格加一行。

原则：
- 断言函数只做**一件事**，消息要能自解释（失败时不用翻代码就知道哪错了）。
- 涉及渲染进程状态的，用 `window.evaluate` 取值，别把 DOM 逻辑写在 Node 侧。
- 通用的才放进 kit；只有你一个项目用的（业务断言）放项目里。

## 12. 为什么是纯 JS + 手写 d.ts

刻意的设计取舍：

- **纯 ESM JS，零构建**：没有 tsc / bundler / dist 目录，无需 rebuild。对一个几百行的工具包，构建链的维护成本大于收益。（注意 pnpm `file:` 依赖是拷贝，改完仍需 `pnpm install` 同步到消费者，见 §3。）
- **手写 `index.d.ts`**：换来完整的 TS 使用体验（补全、类型检查），又不引入构建步骤。代价是加函数时要同步改两处（实现 + 声明）——量小，可接受。
- **peer 依赖 Playwright**：不把 Playwright 打进来，用被测项目自己的版本，避免版本双份/冲突。

如果将来 kit 长大到几千行、多文件，再考虑迁到 TS + 构建产物。现在不需要。

## 13. 自测与发布

### 自测（独立套件，不依赖任何消费者）

kit 有自己的测试，跑在一个最小 Electron fixture（`test/fixtures/basic-app/`，
无 React/Vite/后端）上，覆盖 launch 生命周期、窗口选择/readiness、每个断言，
以及"假绿"防线（null bridge、内部 TypeError 不能伪装成安全拒绝）。

```bash
cd electron-test-kit
pnpm install          # 首次：装 electron/playwright/typescript（devDeps）
pnpm typecheck        # d.ts 与真实 API 一致
pnpm test             # 对 fixture 跑全部自测（本地 macOS/Windows 直接跑）
pnpm pack:check       # tarball 只含预期文件（快，纯文件列表）
pnpm pack:consumer    # 打真 tarball，全新 npm install 后 import+launch（验打包边界）
```

CI（`.github/workflows/electron-test-kit.yml`）在 Linux + xvfb 上跑这几件。
`pack:consumer` 是 L3 关键：`file:` 依赖会掩盖 exports/files/peer 缺失，只有
真安装 tarball 才暴露。
改完 kit 必做这一套；FlowKit 那类真实消费者的 e2e 是额外的集成验证。

**fixture 的状态开关**（`FIXTURE_MODE` 环境变量）：`normal` / `splash` /
`nowindow` / `crash`——分别制造正常、splash+主窗、永不开窗、主进程崩溃，
用来测各条清理和窗口选择路径。加新断言时顺手给 fixture 补对应能力。

### 发布到 npm（方式 C）

发布前补齐：

1. `package.json` 加 `repository`、`license`、`prepublishOnly`：
   ```jsonc
   "license": "MIT",
   "repository": { "type": "git", "url": "..." },
   "scripts": { "prepublishOnly": "node -e \"require('./index.js')\"" }
   ```
2. 加 `LICENSE` 文件。
3. `files` 字段已限定只发 `index.js` / `index.d.ts` / `README.md`（当前 package.json 已配）。
4. 校验打包内容：`npm pack --dry-run`。
5. 发布：`npm publish`（私有 registry 加 `--registry`，或用 GitHub Packages）。
6. 版本遵循 semver：加断言=minor，改签名/删函数=major，修 bug=patch。

## 14. FAQ

**Q：能测多窗口 / splash 应用吗？**
A：能，但要自己配。默认 `launchElectron` 只取首个窗口 + 等 `domcontentloaded`——对有 splash 的应用这可能选错窗口或过早判定就绪。传 `selectWindow` 从 `app.windows()` 里挑主窗口、传 `ready` 定义真正的就绪条件即可。其余窗口仍可用 `app.windows()` / `app.waitForEvent('window')` 拿。

**Q：能不能不弹窗口（headless）？**
A：Electron 没有真正的 headless。CI 上用 xvfb 虚拟显示（看不见）。本地想安静，可以让主进程读一个环境变量（如 `E2E_HIDE_WINDOW`）时用 `show: false` 创建窗口——DOM 和 IPC 断言在隐藏窗口照常工作。

**Q：为什么不用 spectron？**
A：spectron 已废弃。Playwright 的 `_electron` 是目前官方推荐的 Electron 自动化方案。

**Q：测试很慢怎么办？**
A：e2e 天生慢。原则是"能单测的别放 e2e"。e2e 只留启动冒烟、安全、关键旅程。真要提速可以谨慎地在无状态冲突的测试间共享一个 app 实例，但会牺牲隔离性，不推荐作为默认。

**Q：`file:` 依赖改了 kit 没生效？**
A：看包管理器。pnpm 的 `file:` 是安装期拷贝，改完必须 `pnpm install` 才同步；npm/yarn 多为真软链，直接生效。保险起见改完 kit 一律 `pnpm install` 一次。

---

有补充需求（比如加个 fixture app 做 kit 自测、或整理成独立发布仓库），告诉我。
