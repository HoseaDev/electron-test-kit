import { defineConfig } from '@playwright/test'

/**
 * electron-test-kit 自测配置。
 * 对 test/fixtures/basic-app 这个最小 Electron 应用跑 kit 的每个 API，
 * 证明 kit 本身正确（此前 kit 只靠使用它的项目间接验证）。
 */
export default defineConfig({
  testDir: './test',
  testMatch: /.*\.e2e\.mjs$/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // Electron 启停有时序成本，串行更稳
  workers: 1,
  retries: 0,
  reporter: [['list']],
})
