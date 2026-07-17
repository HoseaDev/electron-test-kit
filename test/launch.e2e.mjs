/**
 * 生命周期自测：启动、隔离、清理、幂等 close、失败不泄漏。
 */
import { test, expect } from '@playwright/test'
import { existsSync } from 'node:fs'
import { launchElectron } from '../index.js'
import { KIT_ROOT, NO_SANDBOX, countLeakDirs, launchOpts } from './_fixture.mjs'

test('正常启动 + 隔离目录存在 + close 后删除', async () => {
  const h = await launchElectron(launchOpts())
  try {
    expect(h.userDataDir).toBeTruthy()
    expect(existsSync(h.userDataDir)).toBe(true)
    await expect(h.window).toHaveTitle('fixture')
  } finally {
    const dir = h.userDataDir
    await h.close()
    expect(existsSync(dir), 'close 后隔离目录应被删除').toBe(false)
  }
})

test('close 幂等：串行两次 + 并发三次都不抛错、目录删除', async () => {
  const h = await launchElectron(launchOpts())
  const dir = h.userDataDir
  await h.close()
  await h.close() // 第二次不应抛错
  const h2 = await launchElectron(launchOpts())
  const dir2 = h2.userDataDir
  await Promise.all([h2.close(), h2.close(), h2.close()]) // 并发
  expect(existsSync(dir)).toBe(false)
  expect(existsSync(dir2)).toBe(false)
})

test('不存在的 entry：抛错且不泄漏临时目录', async () => {
  const before = countLeakDirs()
  await expect(
    launchElectron({ entry: '/no/such/main.cjs', cwd: KIT_ROOT }),
  ).rejects.toThrow(/主进程入口不存在/)
  expect(countLeakDirs(), '启动前失败不应创建/泄漏目录').toBe(before)
})

test('firstWindow 超时（永不开窗）：抛错、清理进程和目录、不泄漏', async () => {
  const before = countLeakDirs()
  await expect(
    launchElectron(launchOpts({ env: { FIXTURE_MODE: 'nowindow' }, firstWindowTimeout: 2500 })),
  ).rejects.toThrow()
  await new Promise((r) => setTimeout(r, 1000)) // 给清理留时间
  expect(countLeakDirs(), 'firstWindow 超时后不应泄漏目录').toBe(before)
})

test('主进程启动即崩：抛错且不泄漏目录', async () => {
  const before = countLeakDirs()
  await expect(
    launchElectron(launchOpts({ env: { FIXTURE_MODE: 'crash' }, firstWindowTimeout: 4000 })),
  ).rejects.toThrow()
  await new Promise((r) => setTimeout(r, 1000))
  expect(countLeakDirs(), '主进程崩溃后不应泄漏目录').toBe(before)
})

test('executablePath 覆盖：显式传二进制路径也能启动', async () => {
  const { createRequire } = await import('node:module')
  const requireFromKit = createRequire(KIT_ROOT + '/package.json')
  const electronPath = requireFromKit('electron')
  const h = await launchElectron({
    entry: launchOpts().entry,
    cwd: KIT_ROOT,
    noSandbox: NO_SANDBOX,
    executablePath: electronPath,
  })
  try {
    await expect(h.window).toHaveTitle('fixture')
  } finally {
    await h.close()
  }
})
