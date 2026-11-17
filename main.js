'use strict';
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

const INDEX = path.join(__dirname, 'index.html');

function isExternal(url) {
  return /^https?:\/\//i.test(url);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  // Links with target=_blank or window.open: system browser for http(s), nothing else.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Block any in-window navigation away from the app page.
  win.webContents.on('will-navigate', (event, url) => {
    if (url === win.webContents.getURL()) return;
    event.preventDefault();
    if (isExternal(url)) shell.openExternal(url);
  });

  win.loadFile(INDEX);
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    // Standard menu keeps copy/paste, window and quit shortcuts working.
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
