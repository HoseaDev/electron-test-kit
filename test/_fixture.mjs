/**
 * 自测公用：fixture 路径 + 平台相关的 launch 参数。
 */
import path from 'node:path'
import { readdirSync } from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** kit 根目录（electron 作为 devDep 装在这里，launchElectron 从这里解析二进制） */
export const KIT_ROOT = path.resolve(__dirname, '..')

/** fixture 主进程入口 */
export const FIXTURE_ENTRY = path.join(__dirname, 'fixtures', 'basic-app', 'main.cjs')

/** Linux / CI 上需要 --no-sandbox */
export const NO_SANDBOX = !!process.env.CI || process.platform === 'linux'

/** 统计 tmp 目录里 kit 创建的隔离目录数量（用于泄漏检测） */
export function countLeakDirs() {
  return readdirSync(os.tmpdir()).filter((n) => n.startsWith('electron-e2e-')).length
}

/** launchElectron 的公共选项 */
export function launchOpts(extra = {}) {
  return { entry: FIXTURE_ENTRY, cwd: KIT_ROOT, noSandbox: NO_SANDBOX, ...extra }
}
