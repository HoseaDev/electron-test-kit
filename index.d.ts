import type { ElectronApplication, Page } from 'playwright'

export interface LaunchOptions {
  /** 主进程入口（构建产物），相对 cwd 或绝对路径 */
  entry: string
  /** 应用项目根目录，默认 process.cwd() */
  cwd?: string
  /** 附加环境变量（合并进 process.env） */
  env?: Record<string, string>
  /** 附加命令行参数 */
  args?: string[]
  /**
   * 用临时 userData 目录隔离本次启动（默认 true），关闭时自动清理。
   * 需要应用主进程支持 --user-data-dir 开关。
   */
  isolateUserData?: boolean
  /**
   * 是否传 --no-sandbox（默认 false）。受限 CI 容器需要时由调用方显式开启，
   * 不再按平台静默降级，避免掩盖 sandbox 回归。
   */
  noSandbox?: boolean
  /** 收集主进程 stdout/stderr 到 mainLogs（默认 false） */
  recordMainProcessLogs?: boolean
  /** 等首个窗口的超时（毫秒，默认 30000） */
  firstWindowTimeout?: number
  /** 显式指定 Electron 二进制；不传时从 cwd 项目解析 */
  executablePath?: string
  /**
   * 多窗口 / splash 应用选主窗口；不传时用首个窗口。
   * 第二参 app 可用于等待稍后打开的窗口（app.waitForEvent('window')）。
   */
  selectWindow?: (windows: Page[], app: ElectronApplication) => Page | Promise<Page>
  /** 自定义就绪判定；不传时只等 'domcontentloaded' */
  ready?: (window: Page, app: ElectronApplication) => Promise<void>
}

export interface LaunchedApp {
  app: ElectronApplication
  window: Page
  mainLogs: string[]
  userDataDir: string | null
  /** 幂等：多次调用只真正关闭一次 */
  close: () => Promise<void>
}

export declare function launchElectron(options: LaunchOptions): Promise<LaunchedApp>

export declare function expectMainWindowExists(app: ElectronApplication): Promise<void>

export declare function expectBridgeExposed(window: Page, bridgeKey: string): Promise<void>

export declare function expectNodeIntegrationDisabled(window: Page): Promise<void>

export interface CspRules {
  mustInclude?: string[]
  mustNotInclude?: string[]
}

export declare function expectMetaCspContains(window: Page, rules?: CspRules): Promise<void>

/** @deprecated 用 expectMetaCspContains */
export declare function expectStrictCSP(window: Page, rules?: CspRules): Promise<void>

export interface CallBridgeOptions {
  /** 挂住的 IPC 超时（毫秒） */
  timeout?: number
}

export declare function callBridgeMethod<T = unknown>(
  window: Page,
  bridgeKey: string,
  methodPath: string[],
  args?: unknown[],
  options?: CallBridgeOptions,
): Promise<T>

export interface RejectOptions {
  /** 返回值满足此谓词即视为"已拒绝" */
  rejectIf?: (result: unknown) => boolean
  /**
   * 抛出的错误 message 必须匹配（子串或正则）才算拒绝。
   * 只匹配 message——错误跨 contextBridge/IPC 边界时 error.code 等自定义
   * 属性通常被剥离，只有 name/message 可靠存活。
   */
  errorMatches?: string | RegExp
  /** 断言失败时的提示信息 */
  message?: string
  /** 挂住的 IPC 超时（毫秒） */
  timeout?: number
}

export declare function expectIpcRejected(
  window: Page,
  bridgeKey: string,
  methodPath: string[],
  args: unknown[],
  options?: RejectOptions,
): Promise<void>
