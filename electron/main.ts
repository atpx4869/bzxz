import { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain, session } from 'electron';

Menu.setApplicationMenu(null);
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createApp } from '../src/api/app';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverPort = 0;

// Default download path — persists in userData
const SETTINGS_FILE = path.join(app.getPath('userData'), 'bzxz-settings.json');
function loadSettings(): { downloadPath: string } {
  try {
    if (existsSync(SETTINGS_FILE)) return JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'));
  } catch {}
  return { downloadPath: path.join(app.getPath('downloads'), 'bzxz') };
}
function saveSettings(s: { downloadPath: string }) {
  try { writeFileSync(SETTINGS_FILE, JSON.stringify(s)); } catch {}
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'bzxz · 标准检索',
    icon: path.join(__dirname, '..', '..', 'public', 'favicon-256.png'),
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
  const iconPath = path.join(__dirname, '..', '..', 'public', 'favicon-32.png');
  let icon = nativeImage.createEmpty();
  try {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch {
    // fallback to empty image
  }
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
  // app.getAppPath() = app.asar in packed, project root in dev
  // process.resourcesPath = resources/ dir in packed, undefined in dev
  const baseDir = (process as any).resourcesPath
    ? (process as any).resourcesPath // resources/ dir where extraResources live
    : process.cwd();

  // Ensure data dir exists (outside asar, writable)
  const dataDir = path.join(baseDir, 'data', 'exports');
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  process.env.BZXZ_BASE_DIR = baseDir;

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

  // Download interception — auto-save to configured path, no dialog
  const settings = loadSettings();
  if (!existsSync(settings.downloadPath)) mkdirSync(settings.downloadPath, { recursive: true });

  session.defaultSession.on('will-download', (_event, item) => {
    const filePath = path.join(settings.downloadPath, item.getFilename());
    item.setSavePath(filePath);
  });

  // IPC: get/set download path
  ipcMain.handle('bzxz:get-download-path', () => settings.downloadPath);
  ipcMain.handle('bzxz:set-download-path', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择默认下载路径', properties: ['openDirectory', 'createDirectory'],
    });
    if (!result.canceled && result.filePaths[0]) {
      settings.downloadPath = result.filePaths[0];
      saveSettings(settings);
    }
    return settings.downloadPath;
  });
  ipcMain.handle('bzxz:open-download-folder', () => {
    require('electron').shell.openPath(settings.downloadPath);
  });

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
