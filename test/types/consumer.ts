/**
 * 类型消费者示例。它本身不运行，只用来在 CI 里 typecheck：
 * 证明 index.d.ts 与真实 API 一致、新字段可用、返回类型正确。
 * 编译不过就说明 d.ts 漂移了。
 */
import {
  launchElectron,
  expectMainWindowExists,
  expectBridgeExposed,
  expectNodeIntegrationDisabled,
  expectWebPreferences,
  expectMetaCspContains,
  callBridgeMethod,
  expectIpcRejected,
  type LaunchedApp,
} from '../../index.js'

export async function scenario(): Promise<void> {
  // 全量选项，含新增的 executablePath / selectWindow / ready
  const handle: LaunchedApp = await launchElectron({
    entry: 'dist/main.js',
    cwd: '/tmp/app',
    env: { NODE_ENV: 'test' },
    args: ['--foo'],
    isolateUserData: true,
    noSandbox: false,
    recordMainProcessLogs: true,
    firstWindowTimeout: 20_000,
    executablePath: '/path/to/electron',
    selectWindow: (windows) => windows[0],
    ready: async (window) => {
      await window.waitForLoadState('domcontentloaded')
    },
  })

  const { app, window, mainLogs, userDataDir, close } = handle
  const _logs: string[] = mainLogs
  const _dir: string | null = userDataDir

  await expectMainWindowExists(app)
  await expectBridgeExposed(window, 'electronAPI')
  await expectNodeIntegrationDisabled(window)
  await expectWebPreferences(app)
  await expectWebPreferences(app, { sandbox: true, webSecurity: true })
  await expectMetaCspContains(window, { mustInclude: ["default-src 'self'"], mustNotInclude: [] })

  // 泛型返回类型
  const result = await callBridgeMethod<string>(window, 'electronAPI', ['app', 'getPath'], ['downloads'], {
    timeout: 3000,
  })
  const _r: string = result

  await expectIpcRejected(window, 'electronAPI', ['fs', 'readFile'], ['/etc/passwd'], {
    rejectIf: (r) => typeof r === 'object' && r !== null,
    errorMatches: /denied/,
    timeout: 3000,
    message: 'should be denied',
  })

  // 返回值拒绝型通道：抛异常即失败
  await expectIpcRejected(window, 'electronAPI', ['storage', 'set'], ['../x', 'v'], {
    rejectIf: (r) => r === false,
    throwIsFailure: true,
  })

  await close()
  void _logs
  void _dir
  void _r
}
