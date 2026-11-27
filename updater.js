'use strict';
// Update notice and in-app install for the desktop application.
//
// Builds that can replace themselves (Windows installer, Linux AppImage) use electron-updater
// with the GitHub releases of the project: the update is downloaded on request and installed
// on restart. The other builds (macOS, not code-signed; Windows portable; Linux archive) only
// get a notice whose button opens the download page.
//
// The renderer talks to this module through preload.js (window.smithDesktop). Every change is
// pushed to the window as one state object:
//   { state, current, version, percent, message, canInstall, manual }
//   state: idle | checking | none | available | downloading | ready | error | dev
const { app, ipcMain, net, shell } = require('electron');

const OWNER = 'blatti-thomas';
const REPO = 'smith-chart';
const PAGE = `https://github.com/${OWNER}/${REPO}/releases/latest`;
const API = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
const FIRST_CHECK_MS = 5000;

const canInstall = () => app.isPackaged && (
  (process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_DIR)
  || (process.platform === 'linux' && Boolean(process.env.APPIMAGE)));

/** True if version a is newer than version b ("v1.10.0" > "1.9.3"); pre-release suffixes are ignored. */
const newer = (a, b) => {
  const parts = (v) => String(v).replace(/^v/, '').split('-')[0].split('.').map((n) => Number(n) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0;
  }
  return false;
};

const firstLine = (err) => String((err && err.message) || err).split('\n')[0];

function setupUpdates(getWindow) {
  let state = { state: 'idle', current: app.getVersion(), canInstall: canInstall(), manual: false };
  const send = (patch) => {
    state = { ...state, ...patch };
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('update:state', state);
  };

  let updater = null;
  if (state.canInstall) {
    ({ autoUpdater: updater } = require('electron-updater'));
    updater.autoDownload = false;          // the user chooses when to download
    updater.autoInstallOnAppQuit = true;   // a downloaded update is installed at the next quit
    updater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent) }));
    updater.on('update-downloaded', (info) => send({ state: 'ready', version: info.version }));
    updater.on('error', () => {});         // errors are reported by the promise of each call
  }

  let busy = false;
  const check = async (manual) => {
    if (!app.isPackaged) {
      if (manual) send({ state: 'dev', manual });
      return;
    }
    if (state.state === 'downloading' || state.state === 'ready') {
      if (manual) send({ manual });         // show the current download again
      return;
    }
    if (busy) return;
    busy = true;
    if (manual) send({ state: 'checking', manual });
    try {
      let latest = null;
      if (updater) {
        // electron-updater decides itself (it may refuse an update); downloadUpdate() needs its yes
        const result = await updater.checkForUpdates();
        if (result && result.isUpdateAvailable) latest = result.updateInfo.version;
      } else {
        const res = await net.fetch(API, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': `smith-chart/${app.getVersion()}` },
        });
        if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
        const tag = (await res.json()).tag_name;
        if (tag && newer(tag, state.current)) latest = tag;
      }
      if (latest) send({ state: 'available', version: String(latest).replace(/^v/, ''), manual });
      else if (manual) send({ state: 'none', manual });
    } catch (err) {
      if (manual) send({ state: 'error', message: firstLine(err), manual });
    } finally {
      busy = false;
    }
  };

  const install = async () => {
    if (state.state === 'ready' && updater) {
      setImmediate(() => updater.quitAndInstall(true, true));
      return;
    }
    if (state.state !== 'available') return;
    if (!updater) {
      shell.openExternal(PAGE);
      return;
    }
    send({ state: 'downloading', percent: 0 });
    try {
      await updater.downloadUpdate();
    } catch (err) {
      send({ state: 'error', message: firstLine(err), manual: true });
    }
  };

  // Only the application page (a local file) may drive the updater.
  const fromApp = (event) => Boolean(event.senderFrame && event.senderFrame.url.startsWith('file:'));
  ipcMain.handle('update:state', (event) => (fromApp(event) ? state : null));
  ipcMain.handle('update:check', (event) => (fromApp(event) ? check(true) : null));
  ipcMain.handle('update:install', (event) => (fromApp(event) ? install() : null));

  setTimeout(() => check(false), FIRST_CHECK_MS);
}

module.exports = { setupUpdates, newer };
