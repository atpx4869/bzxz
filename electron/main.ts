import { app, BrowserWindow, Tray, Menu, nativeImage, dialog } from 'electron';
import path from 'node:path';
import { createApp } from '../src/api/app';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverPort = 0;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'bzxz · 标准检索',
    icon: path.join(__dirname, '..', 'public', 'favicon.ico'),
    backgroundColor: '#1a1a2e',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${serverPort}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  // Use empty image as fallback — tray still works via tooltip + context menu
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    { label: '打开 bzxz', click: () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      } else {
        createWindow();
      }
    }},
    { type: 'separator' },
    { label: '退出', click: () => {
      app.quit();
    }},
  ]);

  tray.setToolTip('bzxz · 标准检索');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}

async function startServer(): Promise<number> {
  const expressApp = createApp();
  return new Promise((resolve) => {
    const server = expressApp.listen(0, () => {  // 0 = random available port
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 3000;
      resolve(port);
    });
  });
}

app.whenReady().then(async () => {
  serverPort = await startServer();
  console.log(`Server on http://localhost:${serverPort}`);

  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  // Keep running in tray on Windows
  if (process.platform !== 'darwin') {
    // Don't quit, keep in tray
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  tray?.destroy();
  tray = null;
});
