/**
 * fixture preload：通过 contextBridge 暴露一组纯函数 bridge，
 * 覆盖 kit 断言需要的各种返回/抛错形态。
 */
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('testAPI', {
  // 成功返回（测 callBridgeMethod）
  echo: (x) => x,
  // 业务拒绝：返回失败对象（测 expectIpcRejected 的 rejectIf 路径）
  reject: () => ({ success: false }),
  // 抛 TypeError（测 errorMatches + 防"内部错误伪装成安全拒绝"）
  throwType: () => {
    throw new TypeError('boom-type')
  },
  // 抛带 code 的错误（测 errorCode 路径）
  throwCoded: () => {
    const e = new Error('coded failure')
    e.code = 'EPERM'
    throw e
  },
})
