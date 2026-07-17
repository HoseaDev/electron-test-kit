/**
 * 断言原语自测：bridge 暴露 / Node 泄漏 / CSP / IPC 调用与拒绝。
 * 特别覆盖"假绿"防线：null bridge、内部 TypeError 不能伪装成安全拒绝。
 */
import { test, expect } from '@playwright/test'
import {
  launchElectron,
  expectBridgeExposed,
  expectNodeIntegrationDisabled,
  expectMetaCspContains,
  callBridgeMethod,
  expectIpcRejected,
} from '../index.js'
import { launchOpts } from './_fixture.mjs'

/** 断言一个 kit 断言会失败（负例） */
async function assertFails(fn, why) {
  let threw = false
  try {
    await fn()
  } catch {
    threw = true
  }
  expect(threw, why).toBe(true)
}

test('expectBridgeExposed：testAPI 通过、null bridge 失败、缺失 key 失败', async () => {
  const h = await launchElectron(launchOpts())
  try {
    await expectBridgeExposed(h.window, 'testAPI')
    // index.html 里 window.nullBridge = null；typeof null==='object' 的坑必须被挡
    await assertFails(() => expectBridgeExposed(h.window, 'nullBridge'), 'null bridge 应失败')
    await assertFails(() => expectBridgeExposed(h.window, 'noSuchKey'), '缺失 key 应失败')
  } finally {
    await h.close()
  }
})

test('expectNodeIntegrationDisabled：sandbox 渲染进程无 Node 全局', async () => {
  const h = await launchElectron(launchOpts())
  try {
    await expectNodeIntegrationDisabled(h.window)
  } finally {
    await h.close()
  }
})

test('expectMetaCspContains：命中/未命中/排除', async () => {
  const h = await launchElectron(launchOpts())
  try {
    await expectMetaCspContains(h.window, {
      mustInclude: ["default-src 'self'", "object-src 'none'"],
      mustNotInclude: ["'unsafe-eval'"],
    })
    await assertFails(
      () => expectMetaCspContains(h.window, { mustInclude: ["frame-ancestors 'none'"] }),
      '不存在的 directive 应失败',
    )
    await assertFails(
      () => expectMetaCspContains(h.window, { mustNotInclude: ["default-src 'self'"] }),
      '存在的 directive 出现在 mustNotInclude 应失败',
    )
  } finally {
    await h.close()
  }
})

test('callBridgeMethod：echo 返回值、空 methodPath 报错、缺失方法报错', async () => {
  const h = await launchElectron(launchOpts())
  try {
    const r = await callBridgeMethod(h.window, 'testAPI', ['echo'], ['hello'])
    expect(r).toBe('hello')
    await assertFails(() => callBridgeMethod(h.window, 'testAPI', []), '空 methodPath 应报错')
    await assertFails(() => callBridgeMethod(h.window, 'testAPI', ['nope']), '缺失方法应报错')
  } finally {
    await h.close()
  }
})

test('expectIpcRejected：业务拒绝 / errorMatches / errorCode / 假绿防线', async () => {
  const h = await launchElectron(launchOpts())
  try {
    // 1) 返回失败对象 → rejectIf 判定
    await expectIpcRejected(h.window, 'testAPI', ['reject'], [], {
      rejectIf: (r) => typeof r === 'object' && r !== null && r.success === false,
    })

    // 2) 抛 TypeError('boom-type') → errorMatches 命中（message 跨边界可靠存活）
    await expectIpcRejected(h.window, 'testAPI', ['throwType'], [], {
      errorMatches: /boom-type/,
    })

    // 3) 假绿防线：errorMatches 不匹配时，即使抛了错也必须 FAIL
    //    （防止内部 TypeError 伪装成"安全拒绝"）
    await assertFails(
      () =>
        expectIpcRejected(h.window, 'testAPI', ['throwType'], [], {
          errorMatches: /permission denied/,
        }),
      'errorMatches 不匹配的异常不应算作拒绝',
    )

    // 4) 方法不存在必须 FAIL（不算拒绝）
    await assertFails(
      () => expectIpcRejected(h.window, 'testAPI', ['ghost'], [], { rejectIf: () => true }),
      '方法不存在应 fail',
    )

    // 5) 返回了正常值但没给 rejectIf → FAIL（没被拒绝）
    await assertFails(
      () => expectIpcRejected(h.window, 'testAPI', ['echo'], ['x']),
      '返回正常值应视为未拒绝',
    )
  } finally {
    await h.close()
  }
})
