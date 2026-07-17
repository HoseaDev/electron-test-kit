/**
 * 窗口选择 / readiness / 日志收集自测。
 */
import { test, expect } from '@playwright/test'
import { launchElectron, expectMainWindowExists } from '../index.js'
import { launchOpts } from './_fixture.mjs'

test('selectWindow：splash 场景选到主窗口', async () => {
  let sawWindows = 0
  const findMain = async (windows) => {
    for (const w of windows) {
      if ((await w.title()) === 'main-window') return w
    }
    return null
  }
  const h = await launchElectron(
    launchOpts({
      env: { FIXTURE_MODE: 'splash' },
      // 主窗口 500ms 后才开，用 app 等它出现（splash/main 的典型场景）
      selectWindow: async (windows, app) => {
        sawWindows = windows.length
        let main = await findMain(windows)
        while (!main) {
          await app.waitForEvent('window', { timeout: 5000 })
          main = await findMain(app.windows())
        }
        return main
      },
    }),
  )
  try {
    await expect(h.window).toHaveTitle('main-window')
    expect(sawWindows).toBeGreaterThan(0)
    await expectMainWindowExists(h.app)
  } finally {
    await h.close()
  }
})

test('ready 钩子被 await：自定义就绪判定生效', async () => {
  let readyCalled = false
  const h = await launchElectron(
    launchOpts({
      ready: async (window) => {
        readyCalled = true
        // 断言就绪时 #root 已渲染
        await window.waitForFunction(() => {
          const el = document.getElementById('root')
          return !!el && el.textContent.includes('fixture ok')
        })
      },
    }),
  )
  try {
    expect(readyCalled, 'ready 钩子应被调用').toBe(true)
  } finally {
    await h.close()
  }
})

test('recordMainProcessLogs：mainLogs 机制可用（不 crash、返回数组）', async () => {
  // 注意：Playwright+Electron 下主进程 console 通常走继承 fd 而非 app.process()
  // 的 pipe，所以 mainLogs 常常抓不到主进程 stdout。这里只验证机制不炸、类型正确，
  // 不断言能抓到具体内容（那不可靠）。mainLogs 的可靠用途是 kit 自己的清理诊断。
  const h = await launchElectron(launchOpts({ recordMainProcessLogs: true }))
  try {
    expect(Array.isArray(h.mainLogs)).toBe(true)
  } finally {
    await h.close()
  }
})
