/**
 * @hoseadev/electron-test-kit
 *
 * Playwright Electron e2e 测试原语。
 *
 * 支持范围（诚实边界，勿夸大）：
 * - 启动**未打包**的 Electron main entry（构建产物，如 dist-electron/main/index.js）做 e2e。
 * - 暂不承诺：asar / 安装包 / 签名 / 自动更新 / CJS 消费 / 多 Electron 版本兼容。
 *
 * 设计约定：
 * - 测的是构建产物，不是 dev server。跑前先构建。
 * - 每次 launch 默认用独立临时 userData 目录（isolateUserData），关闭时清理。
 *   需要应用主进程支持 `--user-data-dir`（见 README）。
 * - 纯 ESM，无构建步骤，peer 依赖 @playwright/test / playwright。
 * - 任何启动失败路径都不泄漏 Electron 进程或临时目录。
 */

import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright'
import { expect } from '@playwright/test'

/** JSON.stringify 的安全版：遇到 BigInt / 循环引用不再二次抛错。 */
function safeStringify(value) {
  try {
    return JSON.stringify(value)
  } catch {
    try {
      return String(value)
    } catch {
      return '<unstringifiable>'
    }
  }
}

/** 校验 methodPath 是非空字符串数组（防止拼错静默通过）。 */
function assertMethodPath(methodPath) {
  if (
    !Array.isArray(methodPath) ||
    methodPath.length === 0 ||
    methodPath.some((s) => typeof s !== 'string' || s.length === 0)
  ) {
    throw new Error(
      '[electron-test-kit] methodPath 必须是非空字符串数组，例如 ["fs", "readFile"]',
    )
  }
}

/**
 * 从被测项目的 node_modules 解析 electron 可执行文件路径。
 * （`require('electron')` 在 Node 环境下返回二进制路径字符串）
 */
function resolveElectronBinary(cwd) {
  const requireFromApp = createRequire(path.join(cwd, 'package.json'))
  const binary = requireFromApp('electron')
  if (typeof binary !== 'string') {
    throw new Error(
      `[electron-test-kit] 无法从 ${cwd} 解析 electron 二进制路径，请确认该项目安装了 electron，` +
        '或显式传 executablePath。',
    )
  }
  return binary
}

/**
 * 启动一个未打包的 Electron 应用（构建产物）。
 *
 * 生命周期保证：launch 之后的任何一步（选窗口 / readiness）失败，都会
 * 关闭已启动的 app 并删除自动创建的临时 userData 目录，绝不泄漏。
 *
 * @param {object} options
 * @param {string} options.entry - 主进程入口（构建产物），相对 cwd 或绝对路径
 * @param {string} [options.cwd] - 应用项目根目录，默认 process.cwd()
 * @param {Record<string, string>} [options.env] - 附加环境变量（合并进 process.env）
 * @param {string[]} [options.args] - 附加命令行参数
 * @param {boolean} [options.isolateUserData=true] - 用临时 userData 目录隔离本次启动，
 *   关闭时自动清理。需要应用主进程支持 --user-data-dir。
 * @param {boolean} [options.noSandbox=false] - 是否传 --no-sandbox。默认 false；
 *   受限 CI 容器需要时由调用方显式开启（不再按平台静默降级，避免掩盖 sandbox 回归）。
 * @param {boolean} [options.recordMainProcessLogs=false] - 收集主进程 stdout/stderr 到 mainLogs
 * @param {number} [options.firstWindowTimeout=30000] - 等首个窗口的超时（毫秒）
 * @param {string} [options.executablePath] - 显式指定 Electron 二进制；不传时从 cwd 项目解析
 * @param {(windows: import('playwright').Page[], app: import('playwright').ElectronApplication) => (import('playwright').Page | Promise<import('playwright').Page>)} [options.selectWindow]
 *   - 多窗口 / splash 应用用它选主窗口；不传时用首个窗口。第二参 app 可用于
 *     等待稍后打开的窗口（app.waitForEvent('window')）
 * @param {(window: import('playwright').Page, app: import('playwright').ElectronApplication) => Promise<void>} [options.ready]
 *   - 自定义就绪判定；不传时只等 'domcontentloaded'
 * @returns {Promise<import('./index.js').LaunchedApp>}
 */
export async function launchElectron(options) {
  const {
    entry,
    cwd = process.cwd(),
    env = {},
    args = [],
    isolateUserData = true,
    noSandbox = false,
    recordMainProcessLogs = false,
    firstWindowTimeout = 30_000,
    executablePath,
    selectWindow,
    ready,
  } = options ?? {}

  if (!entry) {
    throw new Error('[electron-test-kit] launchElectron 缺少 entry（构建后的主进程入口路径）')
  }
  const entryPath = path.resolve(cwd, entry)
  if (!existsSync(entryPath)) {
    throw new Error(
      `[electron-test-kit] 主进程入口不存在: ${entryPath}\n` +
        '先构建应用（例如 `vite build --mode=test`）再运行 e2e。',
    )
  }

  const launchArgs = [entryPath]
  let userDataDir = null
  const callerSetUserData = args.some((a) => a.startsWith('--user-data-dir'))
  if (isolateUserData && !callerSetUserData) {
    userDataDir = mkdtempSync(path.join(os.tmpdir(), 'electron-e2e-'))
    launchArgs.push(`--user-data-dir=${userDataDir}`)
  }
  if (noSandbox) launchArgs.push('--no-sandbox')
  launchArgs.push(...args)

  // 删除临时目录；失败时把诊断塞进 mainLogs，不完全静默
  const mainLogs = []
  const cleanupDir = () => {
    if (!userDataDir) return
    try {
      rmSync(userDataDir, { recursive: true, force: true })
    } catch (e) {
      mainLogs.push(`[electron-test-kit] 清理临时目录失败: ${userDataDir}: ${e?.message ?? e}\n`)
    }
  }

  let app
  try {
    app = await electron.launch({
      executablePath: executablePath ?? resolveElectronBinary(cwd),
      args: launchArgs,
      cwd,
      env: { ...process.env, ...env },
    })
  } catch (err) {
    // launch 本身失败：没有进程可关，只需清理目录
    cleanupDir()
    throw err
  }

  const proc = app.process()

  // 尽早挂日志监听（launch 已返回，最早期日志可能已过，属 Playwright 固有限制）
  if (recordMainProcessLogs) {
    proc.stdout?.on('data', (chunk) => mainLogs.push(String(chunk)))
    proc.stderr?.on('data', (chunk) => mainLogs.push(String(chunk)))
  }

  // 等底层进程真正退出。必须等到进程死透再删目录——否则将死的 Chromium 会把
  // DevToolsActivePort 等文件写回，造成"删完又被重建"的目录泄漏。
  const waitProcessExit = () =>
    new Promise((resolve) => {
      if (!proc || proc.exitCode !== null || proc.killed) return resolve()
      const done = () => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(done, 5000) // 安全兜底，避免永久挂起
      proc.once('exit', done)
    })

  // 无论用哪种方式关闭（handle.close 或直接 app.close 或崩溃），进程真正退出后清理。
  // 覆盖调用方直接调 app.close() 不经过 handle.close 的情况。cleanupDir 幂等。
  if (userDataDir) {
    proc.once('exit', cleanupDir)
  }

  // 幂等 close：memoize promise，重复/并发调用共享同一结果，错误一致传播。
  // 关闭后等进程退出再删目录，让 handle.close() resolve 时目录已确定清理。
  let closePromise = null
  const close = () => {
    if (!closePromise) {
      closePromise = (async () => {
        try {
          await app.close()
        } finally {
          // app.close() 对"从未开窗"的应用可能不终止进程（无窗口可关），
          // 残留进程会继续往 userData 写 DevToolsActivePort 等文件，
          // 造成"删完又重建"的泄漏。进程未退出时兜底强杀。
          if (proc && proc.exitCode === null && !proc.killed) {
            try {
              proc.kill('SIGKILL')
            } catch {
              /* 进程可能刚好自己退了 */
            }
          }
          await waitProcessExit()
          cleanupDir()
        }
      })()
    }
    return closePromise
  }

  try {
    let window
    if (selectWindow) {
      await app.firstWindow({ timeout: firstWindowTimeout }) // 确保至少有一个窗口
      window = await selectWindow(app.windows(), app)
      if (!window) {
        throw new Error('[electron-test-kit] selectWindow 未返回窗口')
      }
    } else {
      window = await app.firstWindow({ timeout: firstWindowTimeout })
    }

    if (ready) {
      await ready(window, app)
    } else {
      await window.waitForLoadState('domcontentloaded')
    }

    return { app, window, mainLogs, userDataDir, close }
  } catch (err) {
    // 选窗口 / readiness 失败：关闭进程 + 等退出 + 清目录，绝不泄漏
    try {
      await close()
    } catch {
      /* 关闭失败不掩盖原始错误 */
    }
    // 失败路径拿不到 mainLogs（未 return），清理诊断兜底到 stderr
    if (mainLogs.length) {
      for (const line of mainLogs) {
        if (line.includes('清理临时目录失败')) process.stderr.write(line)
      }
    }
    throw err
  }
}

/* ------------------------------------------------------------------ */
/* 通用断言                                                            */
/* ------------------------------------------------------------------ */

/**
 * 断言应用至少有一个 BrowserWindow。
 * @param {import('playwright').ElectronApplication} app
 */
export async function expectMainWindowExists(app) {
  const count = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  expect(count, 'app should have at least one BrowserWindow').toBeGreaterThan(0)
}

/**
 * 断言 contextBridge 暴露了指定 key（是对象且不为 null）。
 * @param {import('playwright').Page} window
 * @param {string} bridgeKey - 例如 'electronAPI'
 */
export async function expectBridgeExposed(window, bridgeKey) {
  const info = await window.evaluate((key) => {
    const v = window[key]
    return { type: typeof v, isNull: v === null }
  }, bridgeKey)
  // typeof null === 'object'，必须单独排除
  expect(info.isNull, `contextBridge key "${bridgeKey}" 不应是 null`).toBe(false)
  expect(info.type, `contextBridge key "${bridgeKey}" 应暴露为对象`).toBe('object')
}

/**
 * 断言渲染进程没有泄漏常见 Node 全局。
 *
 * 注意：这是一个**表层探测**，只检查 require/process/module/Buffer 四个常见全局，
 * 不等于证明了 sandbox / contextIsolation 配置完全正确。要严格验证隔离配置，
 * 应在主进程侧断言 webPreferences。
 * @param {import('playwright').Page} window
 */
export async function expectNodeIntegrationDisabled(window) {
  const leaks = await window.evaluate(() => {
    const found = []
    // @ts-expect-error 探测泄漏
    if (typeof window.require !== 'undefined') found.push('require')
    // @ts-expect-error 探测泄漏
    if (typeof window.process !== 'undefined') found.push('process')
    // @ts-expect-error 探测泄漏
    if (typeof window.module !== 'undefined') found.push('module')
    // @ts-expect-error 探测泄漏
    if (typeof window.Buffer !== 'undefined') found.push('Buffer')
    return found
  })
  expect(leaks, '渲染进程不应泄漏常见 Node 全局').toEqual([])
}

/**
 * 断言页面的 CSP `<meta>` 存在且满足包含/排除规则。
 *
 * 命名诚实：这是**字符串包含检查**，不解析 CSP directive，也不检查响应头 CSP。
 * 够用于回归"某条 directive 还在/没被加回来"，但不是完整的 CSP 校验器。
 * @param {import('playwright').Page} window
 * @param {{mustInclude?: string[], mustNotInclude?: string[]}} [rules]
 */
export async function expectMetaCspContains(window, rules = {}) {
  const { mustInclude = [], mustNotInclude = [] } = rules
  const csp = await window.evaluate(() => {
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy" i]')
    return meta ? meta.getAttribute('content') : null
  })
  expect(csp, 'CSP meta 标签应存在').toBeTruthy()
  for (const directive of mustInclude) {
    expect(csp, `CSP 应包含 "${directive}"`).toContain(directive)
  }
  for (const directive of mustNotInclude) {
    expect(csp, `CSP 不应包含 "${directive}"`).not.toContain(directive)
  }
}

/**
 * @deprecated 用 expectMetaCspContains（名字更诚实：它只做 meta 字符串包含）。
 * 保留别名以免破坏现有调用方，下个大版本移除。
 */
export const expectStrictCSP = expectMetaCspContains

/* ------------------------------------------------------------------ */
/* IPC / bridge 调用                                                   */
/* ------------------------------------------------------------------ */

/**
 * 在渲染进程里调用 bridge 方法，返回结构化结果（不抛异常）。
 * 保留 error 的 name/message/code/stack 以便诊断。
 * 可选 timeout：挂住的 IPC 不再拖到整个测试超时。
 */
async function invokeBridge(window, bridgeKey, methodPath, args, timeout) {
  const evalPromise = window.evaluate(
    async ({ key, methodPath, args }) => {
      try {
        // @ts-expect-error 动态访问 bridge
        let target = window[key]
        for (let i = 0; i < methodPath.length - 1; i++) {
          target = target?.[methodPath[i]]
        }
        const fn = target?.[methodPath[methodPath.length - 1]]
        if (typeof fn !== 'function') {
          return {
            threw: true,
            notFound: true,
            error: `bridge method not found: ${key}.${methodPath.join('.')}`,
          }
        }
        const result = await fn.apply(target, args)
        return { threw: false, result }
      } catch (err) {
        return {
          threw: true,
          error: err instanceof Error ? err.message : String(err),
          name: err && err.name,
          code: err && err.code,
          stack: err && err.stack,
        }
      }
    },
    { key: bridgeKey, methodPath, args },
  )

  if (!timeout) return evalPromise

  let timer
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`[electron-test-kit] bridge 调用超时（${timeout}ms）: ${bridgeKey}.${methodPath.join('.')}`)),
      timeout,
    )
  })
  try {
    return await Promise.race([evalPromise, timeoutPromise])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 调用 bridge 方法并返回结果；方法不存在或抛异常时 throw。
 * @template T
 * @param {import('playwright').Page} window
 * @param {string} bridgeKey
 * @param {string[]} methodPath - 例如 ['fs', 'readFile']
 * @param {unknown[]} [args]
 * @param {{timeout?: number}} [options]
 * @returns {Promise<T>}
 */
export async function callBridgeMethod(window, bridgeKey, methodPath, args = [], options = {}) {
  assertMethodPath(methodPath)
  const outcome = await invokeBridge(window, bridgeKey, methodPath, args, options.timeout)
  if (outcome.threw) {
    throw new Error(
      `[electron-test-kit] ${bridgeKey}.${methodPath.join('.')}(${safeStringify(args)}) 失败: ${outcome.error}`,
    )
  }
  return /** @type {any} */ (outcome.result)
}

/**
 * 断言某个 IPC/bridge 调用被拒绝。判定顺序：
 * 1. 方法不存在 → 直接 fail（防拼错静默通过）。
 * 2. 调用抛异常：
 *    - 若给了 errorMatches，异常 message 必须匹配才算"拒绝"（否则一个内部
 *      TypeError 会伪装成安全拒绝造成假绿）；
 *    - 没给时，任何异常都算拒绝（向后兼容）——**安全关键**的断言建议传
 *      errorMatches，把拒绝钉死在预期错误消息上。
 * 3. 调用返回值：由 rejectIf 判定；没给 rejectIf 则 fail（返回了值就不是拒绝）。
 *
 * 注：只用 message 匹配，不用 error.code——错误跨 contextBridge / IPC 边界时
 * 自定义属性（含 code）通常被剥离，只有 name/message 可靠存活。
 *
 * @param {import('playwright').Page} window
 * @param {string} bridgeKey
 * @param {string[]} methodPath
 * @param {unknown[]} args
 * @param {{rejectIf?: (result: unknown) => boolean, errorMatches?: string | RegExp, message?: string, timeout?: number}} [options]
 */
export async function expectIpcRejected(window, bridgeKey, methodPath, args, options = {}) {
  assertMethodPath(methodPath)
  const { rejectIf, errorMatches, message, timeout } = options
  const outcome = await invokeBridge(window, bridgeKey, methodPath, args, timeout)
  const label = message ?? `${bridgeKey}.${methodPath.join('.')} 应当被拒绝`

  if (outcome.notFound) {
    throw new Error(
      `[electron-test-kit] expectIpcRejected: ${outcome.error}\n` +
        '方法不存在不算"拒绝"——如果通道被有意移除，请单独断言其不存在。',
    )
  }

  if (outcome.threw) {
    if (errorMatches !== undefined) {
      const msg = String(outcome.error ?? '')
      const ok = errorMatches instanceof RegExp ? errorMatches.test(msg) : msg.includes(errorMatches)
      expect(ok, `${label}：抛出的错误 "${msg}" 应匹配 ${errorMatches}`).toBe(true)
      return
    }
    return // 无匹配约束时，任何异常都算拒绝
  }

  const rejected = rejectIf ? rejectIf(outcome.result) : false
  expect(rejected, `${label}（实际返回: ${safeStringify(outcome.result)}）`).toBe(true)
}
