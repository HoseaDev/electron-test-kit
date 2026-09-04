/**
 * electron-test-kit 消费者项目的 Playwright 配置模板。拷到项目根即可用。
 * 要点：只跑 *.e2e.ts、串行、给 Electron 足够的启动超时。
 */
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  testMatch: /.*\.e2e\.ts$/,
  timeout: 60_000, // Electron 启动慢
  expect: { timeout: 10_000 },
  fullyParallel: false, // Electron 启停有时序成本，并发易冲突
  workers: 1,
  retries: 0,
  reporter: [['list']],
})
