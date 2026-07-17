/**
 * 打包消费者测试（L3）：把 kit 打成真 tarball，在一个全新临时项目里
 * `npm install` 它，再 import + launch + bridge。
 *
 * 为什么不能靠 `file:` 依赖或源码目录：那会掩盖 exports 映射、files 白名单、
 * peerDependencies、缺文件等只有"真安装"才暴露的问题。pack:check 只查文件
 * 列表，这个测试查"装完能不能真的 import 和跑"。
 *
 * electron 二进制体积大，这里通过 executablePath 借用 kit dev 环境已下载的
 * electron，只对"打包边界"做验证，不重复下载。
 *
 * 用法：node test/pack-consumer.mjs   （或 pnpm pack:consumer）
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, cpSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const KIT_ROOT = path.resolve(__dirname, '..')

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', ...opts })
}

let tgzPath
let consumerDir
try {
  // 1. 打包
  const tgz = run('npm', ['pack', '--silent'], { cwd: KIT_ROOT }).trim().split('\n').pop()
  tgzPath = path.join(KIT_ROOT, tgz)
  console.log('[pack-consumer] tarball:', tgz)

  // 2. 全新临时消费者项目
  consumerDir = mkdtempSync(path.join(os.tmpdir(), 'etk-consumer-'))
  writeFileSync(
    path.join(consumerDir, 'package.json'),
    JSON.stringify({ name: 'etk-consumer', private: true, type: 'module' }, null, 2),
  )

  // 3. 真安装 tarball + peer 依赖（不装 electron，借用 kit 的）
  console.log('[pack-consumer] npm install tarball + peers ...')
  run('npm', ['install', '--no-audit', '--no-fund', tgzPath, '@playwright/test', 'playwright'], {
    cwd: consumerDir,
    stdio: 'inherit',
  })

  // 4. fixture 拷进消费者
  cpSync(path.join(KIT_ROOT, 'test', 'fixtures'), path.join(consumerDir, 'fixtures'), {
    recursive: true,
  })

  // 5. 消费者冒烟：从**安装的包**（不是源码）import，launch + bridge
  const electronPath = createRequire(path.join(KIT_ROOT, 'package.json'))('electron')
  const smoke = `
import { launchElectron, expectBridgeExposed, callBridgeMethod } from '@hosea/electron-test-kit'
const h = await launchElectron({
  entry: './fixtures/basic-app/main.cjs',
  cwd: process.cwd(),
  executablePath: ${JSON.stringify(electronPath)},
  noSandbox: process.platform === 'linux' || !!process.env.CI,
})
try {
  await expectBridgeExposed(h.window, 'testAPI')
  const r = await callBridgeMethod(h.window, 'testAPI', ['echo'], ['packed'])
  if (r !== 'packed') throw new Error('bridge echo 返回错误: ' + r)
  console.log('PACK-CONSUMER OK')
} finally {
  await h.close()
}
`
  writeFileSync(path.join(consumerDir, 'smoke.mjs'), smoke)
  console.log('[pack-consumer] 运行消费者冒烟 ...')
  const out = run('node', ['smoke.mjs'], { cwd: consumerDir, stdio: 'pipe' })
  process.stdout.write(out)
  if (!out.includes('PACK-CONSUMER OK')) {
    throw new Error('消费者冒烟未通过')
  }
  console.log('[pack-consumer] ✅ 打包边界验证通过')
} finally {
  // 清理
  if (tgzPath) rmSync(tgzPath, { force: true })
  if (consumerDir) rmSync(consumerDir, { recursive: true, force: true })
}
