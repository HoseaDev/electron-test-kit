/**
 * 最小 Electron fixture，用于 electron-test-kit 自测。
 * 刻意笨：无 React / Vite / 后端 / 登录。按 FIXTURE_MODE 制造各种启动状态。
 *
 * FIXTURE_MODE:
 *   normal   (默认) 开一个窗口，标题 "fixture"
 *   splash   先开 splash 窗口，500ms 后开 "main-window"（测 selectWindow）
 *   nowindow 永不开窗（测 firstWindow 超时清理）
 *   crash    主进程 ready 前 exit(1)（测启动失败清理）
 */
const { app, BrowserWindow } = require('electron')
const path = require('node:path')

const MODE = process.env.FIXTURE_MODE || 'normal'

// 支持 --user-data-dir 覆盖（kit 的隔离依赖它）。放在单实例锁之前。
const udd = app.commandLine.getSwitchValue('user-data-dir')
if (udd) {
  app.setPath('userData', udd)
  app.setPath('sessionData', udd)
}

if (MODE === 'crash') {
  process.stderr.write('fixture: intentional crash before ready\n')
  process.exit(1)
}

app.on('window-all-closed', () => {}) // 不自动退出，交给测试 close

function makeWindow(title) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  // 用 query 把标题传给页面，让页面自己设 document.title（稳定，不会被
  // page-title-updated 覆盖成空）
  win.loadFile(path.join(__dirname, 'index.html'), { query: { title } })
  return win
}

app.whenReady().then(() => {
  process.stdout.write(`fixture: ready mode=${MODE}\n`)
  if (MODE === 'nowindow') return
  if (MODE === 'splash') {
    makeWindow('splash')
    setTimeout(() => makeWindow('main-window'), 500)
    return
  }
  makeWindow('fixture')
})
