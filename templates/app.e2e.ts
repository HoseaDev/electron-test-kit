/**
 * 首个 e2e 模板：启动冒烟 + 安全基线 + 渲染无报错。拷到 test/e2e/app.e2e.ts。
 * 跑前先构建：例如 `vite build --mode=test`。
 */
import { test, expect } from '@playwright/test'
import {
  expectMainWindowExists,
  expectBridgeExposed,
  expectNodeIntegrationDisabled,
  expectWebPreferences,
  expectMetaCspContains,
} from '@hoseadev/electron-test-kit'
import { launchApp, collectRendererErrors, BRIDGE_KEY } from './_helpers'

test('应用能启动并打开主窗口', async () => {
  const { app, window, close } = await launchApp()
  try {
    await expectMainWindowExists(app)
    await expect(window).toHaveTitle(/.+/) // TODO: 换成你的应用名正则
  } finally {
    await close()
  }
})

test('安全基线：webPreferences、bridge 暴露、无 Node 泄漏、CSP 存在', async () => {
  const { app, window, close } = await launchApp()
  try {
    // 主进程侧读实际生效的配置（严格），渲染侧探测泄漏（表层），两者互补
    await expectWebPreferences(app) // 默认 { sandbox: true, contextIsolation: true, nodeIntegration: false }
    await expectBridgeExposed(window, BRIDGE_KEY)
    await expectNodeIntegrationDisabled(window)
    // TODO: 按你页面的 CSP meta 调整；没有 CSP meta 的应用先删掉这条
    await expectMetaCspContains(window, {
      mustInclude: ["default-src 'self'"],
      mustNotInclude: ["'unsafe-eval'"],
    })
  } finally {
    await close()
  }
})

test('启动后渲染进程没有未捕获异常和 console.error', async () => {
  const { window, close } = await launchApp()
  const { errors, stop } = collectRendererErrors(window)
  try {
    // TODO: 换成你应用"首屏就绪"的标志元素
    await window.waitForSelector('#root', { timeout: 15_000 })
    expect(errors, '首屏渲染不应有报错').toEqual([])
  } finally {
    stop()
    await close()
  }
})
