/**
 * 项目本地 launch 封装模板。拷到 test/e2e/_helpers.ts，按 TODO 改。
 *
 * 原则：kit 只提供 launch + 安全断言原语；登录 mock、业务 selector、
 * 后端探测等项目特有的东西写在这个文件里，不进 kit。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page, ConsoleMessage } from '@playwright/test'
import { launchElectron, type LaunchedApp } from '@hoseadev/electron-test-kit'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 项目根（本文件在 test/e2e/ 下，上两级） */
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..')

/** TODO: 构建后的主进程入口，相对项目根 */
const MAIN_ENTRY = 'dist-electron/main/index.js'

/** TODO: preload 里 contextBridge.exposeInMainWorld('xxx', ...) 的那个 key */
export const BRIDGE_KEY = 'electronAPI'

/**
 * 启动应用。每个 test() 自己调一次，finally 里 close()。
 * 受限 CI 容器需要时通过 CI 环境变量显式开 noSandbox，本地不开。
 */
export function launchApp(): Promise<LaunchedApp> {
  return launchElectron({
    entry: MAIN_ENTRY,
    cwd: PROJECT_ROOT,
    env: { NODE_ENV: 'test' },
    noSandbox: process.env.CI === 'true',

    // 单窗口应用删掉下面两个钩子即可，kit 默认取首个窗口 + 等 domcontentloaded。

    // splash / 多窗口：选真正的主窗口。主窗晚开时用 app.waitForEvent('window') 等。
    // selectWindow: async (windows, app) => {
    //   const isMain = (w: Page) => !w.url().includes('splash')
    //   let main = windows.find(isMain)
    //   while (!main) {
    //     await app.waitForEvent('window', { timeout: 10_000 })
    //     main = app.windows().find(isMain)
    //   }
    //   return main
    // },

    // 就绪判定：等应用真正渲染出根节点，而不是只等 DOM 加载完。
    // ready: async (window) => {
    //   await window.waitForSelector('#root', { timeout: 15_000 })
    // },
  })
}

/**
 * 收集渲染进程的未捕获异常和 console.error。
 * 冒烟测试的通用写法：遍历界面时每步先 reset()，步后看 errors 是否为空。
 * 这是纯 Playwright 能力，和 Electron 无关，所以放在项目 helper 而不是 kit 里。
 */
export function collectRendererErrors(window: Page): {
  errors: string[]
  reset: () => void
  stop: () => void
} {
  const errors: string[] = []
  const onPageError = (e: Error) => errors.push(`[pageerror] ${e.message}`)
  const onConsole = (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(`[console] ${m.text().slice(0, 300)}`)
  }
  window.on('pageerror', onPageError)
  window.on('console', onConsole)
  return {
    errors,
    reset: () => {
      errors.length = 0
    },
    stop: () => {
      window.off('pageerror', onPageError)
      window.off('console', onConsole)
    },
  }
}
