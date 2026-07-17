# electron-test-kit 路线图：到"多项目可复用"为止

这份文档是给执行者（Claude 或人）看的行动计划，不是愿景稿。它综合了两轮独立评审（Claude 的成熟度分级 + Codex 的修正），目标明确：**把这个包做到"多个未打包 Electron 项目能可靠复用"，并且每一步都不过度设计。**

理想终点是"任何 Electron 应用通用"，但那是有外部用户之后的事。本路线图**只走到 L3**，并明确列出到 L3 为止该砍掉什么。

---

## 成熟度阶梯（已按 Codex 修正）

| 级别 | 含义 | 状态 |
|---|---|---|
| L0 概念验证 | 能启动 Electron 跑断言 | ✅ |
| L0.7 | 能用但有泄漏/假绿/首窗口假设，不算稳 | ✅ 已越过 |
| L1 单项目稳 | 失败不泄漏、close 幂等、不靠 sleep、安全断言不假绿、连续跑稳定 | ✅ 阶段 A+B |
| L2 自身可信 | fixture app + 框架自测 + 单平台 CI | ✅ 阶段 C |
| **L3 多项目可用** | `npm pack` 消费测试 + 两个独立消费者 | ✅ **阶段 D，在这（终点）** |
| L4 可分发（延后） | npm 发布、独立仓库、三平台矩阵、Electron 版本矩阵 | 🚫 有用户前不做 |
| L5 通用（延后） | asar/签名/打包产物、ESM+CJS、TS 源码生成 d.ts | 🚫 按真实需求逐项加 |

**进度**：A+B→L1、C→L2、D→L3 全部完成。**路线图目标达成**：现在可以诚实地说
"多个未打包 Electron 项目可复用"了。两个独立消费者验证通过：fixture 自测套件 +
FlowKit（真实应用，app+security e2e 全绿）。`npm pack` 消费测试证明打包边界
（exports/files/peer）在全新 `npm install` 后完好。

仍**不能**说"任何 Electron 应用通用"——asar/签名/打包产物、跨平台跨 Electron
版本矩阵、npm 发布都属 L4/L5，等有真实外部用户后按需逐项补。

C 阶段用 fixture 自测抓到并修掉 3 个真实契约问题：`errorCode` 跨 bridge 边界被
剥离（移除该选项）、`recordMainProcessLogs` 抓不到主进程 console（诚实标注
best-effort）、`selectWindow` 需要 `app` 参数才能等 splash 后开的主窗（已加）。

**关键顺序修正（Codex 的核心洞见）**：不要"先写自测再想契约"。当前 API 有设计债（`firstWindow` 假设、Linux 默认 `--no-sandbox`、`expectIpcRejected` 接受任意异常）。**先照现在的 API 写测试，等于把这些坑冻结成"兼容行为"，以后改不动。** 所以顺序是：**先定窄契约 → 修 L1 阻断项 → 再用 fixture 锁。**

---

## 阶段 A：先锁定范围与契约（不写新功能，半天）

### A1. 收窄 README/DOCS 的承诺

把"任何 Electron 项目"改成精确承诺：

> 支持用 Playwright 启动**未打包的 Electron main entry** 做 e2e。暂不承诺 asar、安装包、签名、自动更新、CJS 消费、多 Electron 版本。

明确写清：Node 最低版本、Playwright 支持区间、ESM-only、测的是未打包产物、Linux CI 需 xvfb、profile 隔离需应用支持 `--user-data-dir`、多窗口应用必须自己配窗口选择和 readiness。删掉"3 行接入任何 Electron 项目"这类过度宣传。

### A2. `package.json` 补边界字段 + 加 LICENSE

- `"license": "MIT"` + 新增 `electron-test-kit/LICENSE` 文件（**现在就做，法律前提**）
- `"engines": { "node": ">=20" }`（或项目真实最低版本）
- Playwright peer 上界：`">=1.40 <2"`（现在无上界 = 宣称兼容未来 major）
- `scripts`: `test` / `typecheck` / `pack:check`
- 包自己的 devDependencies，不能靠 `frontend/node_modules` 偶然存在

**不做**：npm 发布、拆独立仓库。

---

## 阶段 B：修成真正的 L1（正确性与生命周期）

### B1. 重构 `index.js` 的 launch 生命周期

拆成内部函数（**不引入 class / DI / 插件系统**）：`createUserDataDir → launchProcess → selectWindow → waitUntilReady → cleanup`。必须实现：

- `electron.launch()` 之后任何步骤失败都 `app.close()`
- 任何失败路径都删除自动创建的 userData
- `close()` 幂等（调两次不报错）
- `firstWindow` 超时不留残余进程
- 清理失败要写诊断，不能完全静默
- 校验空 `methodPath`
- 错误格式化避免 `JSON.stringify` 二次抛错（BigInt/循环引用）

### B2. `launchElectron` 加三个最小配置（`index.js` + `index.d.ts` 同步）

```ts
executablePath?: string
selectWindow?: (windows: Page[]) => Page | Promise<Page>
ready?: (window: Page, app: ElectronApplication) => Promise<void>
```

不传时分别退化为：从被测项目解析 Electron / 首窗口 / 只等 `domcontentloaded`。**不做** YAML 配置文件、复杂窗口 DSL。

### B3. 收窄默认与断言

- `--no-sandbox` 默认改为 `false`，由调用方或 CI 显式开启（现在 Linux 无条件关，掩盖 sandbox 回归）
- `expectBridgeExposed` 排除 `null`（`typeof null === 'object'` bug）
- `expectIpcRejected` 加 `errorMatches` / `errorCode`，不再把任意异常当"安全拒绝"；bridge 异常保留 `name/message/code/stack`；bridge 调用加可配 timeout
- 两个过度宣称的 helper 诚实化：`expectNodeIntegrationDisabled` 文档改为"仅检查常见 Node globals"；`expectStrictCSP` 改名 `expectMetaCspContains` 或删除（**不做**完整 CSP parser）

### B4. 同步修 FlowKit 测试入口

- `frontend/package.json`：`test:e2e` 必须先构建再跑；删除或改名"跑陈旧 dist"的入口为 `test:e2e:cached`
- `frontend/test/e2e/_helpers.ts`：helper 初始化失败调 `handle.close()`；用 `ready` 定义 Dashboard readiness（不再用 `body.innerText.length > 0`）；地址/端口走环境变量；**mock 未声明的 API 直接失败**，不再统一返回成功 `null`

---

## 阶段 C：fixture 自测，达到 L2

### C1. 最小 fixture app（`electron-test-kit/test/fixtures/basic-app/`）

`package.json` / `main.mjs` / `preload.cjs` / `index.html`。**不用** React/Vite/登录/后端/数据库——越笨越可靠。用参数制造各种状态：正常主窗口、splash+主窗口、永不创建窗口、主进程启动失败、bridge 成功、bridge 业务拒绝、bridge 内部 `TypeError`、stdout/stderr 输出、回传 userData/argv/env。

### C2. 框架自测（`test/*.e2e.mjs` + `playwright.config.mjs`）

必须覆盖：正常启停；cwd/env/args 传递；`executablePath` override；两次启动不同 userData；正常关闭后目录删除；**`firstWindow` 超时后进程和目录被清理**；主进程启动失败后目录被清理；close 调两次不报错；splash 场景选到主窗口；custom readiness 真被等待；stdout/stderr 被收集；bridge 成功；方法不存在失败；业务拒绝通过；**内部 `TypeError` 不能伪装成安全拒绝**；`expectBridgeExposed(null)` 失败。不给错误文案做脆弱快照。

### C3. 类型一致性（精简版）

一个能编译的 `test/types/consumer.ts` + `tsconfig.types.json`，验证新字段可用、返回类型正确。**不做** TS 源码重写或 d.ts 生成。

### C4. 单平台 CI（属于 L2，不是 L4）

一个 workflow，只跑：Linux + 固定 Node + 固定 Electron/Playwright + xvfb + self-tests + typecheck + pack check。**不做**三平台/版本矩阵。

---

## 阶段 D：验证包边界 + 第二消费者，达到 L3

### D1. `npm pack` 消费测试（L3 必需，不是 L4）

脚本：`npm pack` → 临时 consumer 装 tarball → 启动 fixture → 跑最小 launch/bridge 测试 → 校验 tarball 只含预期文件。`file:../electron-test-kit` 会掩盖 exports/files/peer/缺文件问题，必须用真实打包边界验证。**不需要**发布 npm。

### D2. FlowKit 迁移到新 API（第二消费者）

`_helpers.ts` 用新 API，确保 app launch / security / panels smoke 继续通过。FlowKit 特有的 token/API mock/Redis/中文 selector/构建入口**继续留在 `_helpers.ts`，绝不进 kit**。

### D3. 通用文档去 FlowKit 化

`DOCS.md` 只留中立的 launch/window/readiness/bridge 示例；FlowKit 的登录/panel/Redis 配方移到 `frontend/test/e2e/README.md`；可链接 FlowKit 当案例但不当框架约定；文档示例在 CI 至少编译/执行一次。

---

## 到 L3 为止，明确砍掉（不要碰）

npm publish、独立仓库、changelog 自动化、三平台 CI、Electron 版本矩阵、ESM+CJS 双构建、TS 源码重写、asar、electron-builder 安装包测试、签名公证、自动更新测试、截图/视觉回归系统、登录 mock 框架、API fixture DSL、Redis helper、自定义 reporter、插件系统、构建工具自动探测、Vite/Webpack/Forge 配置生成器。

**这些在第一个外部消费者出现前都是投入黑洞。**

---

## 现在就必须做、别拖的（否则埋坑）

1. **LICENSE**——已在教人拷贝，却无许可证 = 别人法律上没有复制权
2. **收窄"任何 Electron 应用"的承诺**——最容易忽略的大坑，越晚改用户预期越难收
3. **破坏性 API 调整**（窗口选择、readiness、sandbox 默认、IPC 语义）——现在改无成本，有用户后改要背兼容
4. **单平台 CI**——没 CI 的"自测"不算自身可信
5. **peer 上界 + engines**——现在无上界 = 宣称兼容未来所有版本

---

## 一句话总结

不要"冲完 L2 再想 L3"。**先花半天把窄而诚实的 L3 契约定死（阶段 A），修掉 L1 正确性阻断项（阶段 B），再用 fixture 锁契约（阶段 C），最后用打包边界 + FlowKit 双消费者验证（阶段 D）。** 做到这里，可以诚实地说"多个未打包 Electron 项目可复用"——但仍然不能说"任何 Electron 应用通用"。那句话要留到有真实外部用户、逐项补齐 L4/L5 之后。
