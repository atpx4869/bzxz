// Force direct connection — bypass any system proxy (Clash, etc.)
for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
  delete (process.env as Record<string, string | undefined>)[key];
}
process.env.NO_PROXY = '*';

import { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain, session, shell, clipboard } from 'electron';

Menu.setApplicationMenu(null);
import path from 'node:path';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import express, { type Request, type Response, type NextFunction } from 'express';
import { createApp } from '../src/api/app';
import { ensureDataDirs } from '../src/shared/fs';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverPort = 0;
let isQuitting = false;
const UPDATE_REPO = 'atpx4869/bzxz';
const UPDATE_RELEASES_URL = `https://github.com/${UPDATE_REPO}/releases`;
const UPDATE_API_URL = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;

// Default download path — persists in userData
const SETTINGS_FILE = path.join(app.getPath('userData'), 'bzxz-settings.json');
interface DesktopSettings {
  downloadPath: string;
  webServiceEnabled: boolean;
}

interface UpdateAsset {
  name: string;
  url: string;
  size: number;
}

interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
  releaseName?: string;
  publishedAt?: string;
  assets: UpdateAsset[];
  note?: string;
}

function getDefaultSettings(): DesktopSettings {
  return {
    downloadPath: path.join(app.getPath('downloads'), 'bzxz'),
    webServiceEnabled: true,
  };
}

function loadSettings(): DesktopSettings {
  const defaults = getDefaultSettings();
  try {
    if (existsSync(SETTINGS_FILE)) {
      return { ...defaults, ...JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8')) };
    }
  } catch {}
  return defaults;
}
function saveSettings(s: DesktopSettings) {
  try { writeFileSync(SETTINGS_FILE, JSON.stringify(s)); } catch {}
}

function getOpenAtLoginInfo() {
  const loginItem = app.getLoginItemSettings();
  return {
    supported: true,
    openAtLogin: loginItem.openAtLogin,
    openAsHidden: loginItem.openAsHidden,
  };
}

function setOpenAtLogin(enabled: boolean) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
  });
  return getOpenAtLoginInfo();
}

function getLanIps(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
}

function getWebAccessInfo() {
  const settings = loadSettings();
  const localUrl = `http://localhost:${serverPort}`;
  const lanUrls = settings.webServiceEnabled ? getLanIps().map((ip) => `http://${ip}:${serverPort}`) : [];
  return {
    port: serverPort,
    bindHost: '0.0.0.0',
    webServiceEnabled: settings.webServiceEnabled,
    localUrl,
    lanUrls,
    primaryUrl: settings.webServiceEnabled && lanUrls[0] ? lanUrls[0] : localUrl,
    firewallHint: settings.webServiceEnabled
      ? '同一局域网设备访问前，请允许 Windows 防火墙放行 bzxz 或当前端口。'
      : '局域网 Web 访问已关闭；桌面端和本机 localhost 仍可使用。',
  };
}

function setWebServiceEnabled(enabled: boolean) {
  const settings = loadSettings();
  settings.webServiceEnabled = enabled;
  saveSettings(settings);
  updateTrayMenu();
  return getWebAccessInfo();
}

function parseVersion(version: string): number[] {
  return version.replace(/^v/i, '').split(/[.-]/).map((part) => {
    const value = Number.parseInt(part, 10);
    return Number.isFinite(value) ? value : 0;
  });
}

function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff > 0) return true;
    if (diff < 0) return false;
  }
  return false;
}

async function checkForUpdates(): Promise<UpdateInfo> {
  const currentVersion = app.getVersion();
  const response = await fetch(UPDATE_API_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `bzxz/${currentVersion}`,
    },
  });
  if (response.status === 404) {
    return {
      currentVersion,
      latestVersion: currentVersion,
      updateAvailable: false,
      releaseUrl: UPDATE_RELEASES_URL,
      assets: [],
      note: '未找到 GitHub Release。',
    };
  }
  if (!response.ok) {
    throw new Error(`检查更新失败: HTTP ${response.status}`);
  }

  const latest = await response.json() as {
    tag_name?: string;
    html_url?: string;
    name?: string;
    published_at?: string;
    assets?: Array<{ name: string; browser_download_url: string; size: number }>;
  };
  const latestVersion = (latest.tag_name || '').replace(/^v/i, '') || currentVersion;
  return {
    currentVersion,
    latestVersion,
    updateAvailable: isNewerVersion(latestVersion, currentVersion),
    releaseUrl: latest.html_url || UPDATE_RELEASES_URL,
    releaseName: latest.name || latest.tag_name || '',
    publishedAt: latest.published_at || '',
    assets: (latest.assets || []).map((asset) => ({
      name: asset.name,
      url: asset.browser_download_url,
      size: asset.size,
    })),
  };
}

function findInstallerAsset(assets: UpdateAsset[]): UpdateAsset | undefined {
  return assets.find((asset) => /\.exe$/i.test(asset.name) && /setup/i.test(asset.name));
}

function safeDownloadFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 160) || 'bzxz-setup.exe';
}

async function downloadAndInstallUpdate() {
  const info = await checkForUpdates();
  if (!info.updateAvailable) {
    throw new Error('当前已是最新版');
  }
  const asset = findInstallerAsset(info.assets);
  if (!asset) {
    throw new Error('未找到可自动安装的 Setup 安装包，请打开下载页手动下载');
  }

  const updateDir = path.join(app.getPath('temp'), 'bzxz-updates');
  if (!existsSync(updateDir)) mkdirSync(updateDir, { recursive: true });
  const filePath = path.join(updateDir, safeDownloadFileName(asset.name));

  const response = await fetch(asset.url, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': `bzxz/${app.getVersion()}`,
    },
  });
  if (!response.ok || !response.body) {
    throw new Error(`下载安装包失败: HTTP ${response.status}`);
  }

  const total = Number(response.headers.get('content-length')) || asset.size || 0;
  let downloaded = 0;
  const body = Readable.fromWeb(response.body as any);
  body.on('data', (chunk: Buffer) => {
    downloaded += chunk.length;
    mainWindow?.webContents.send('bzxz:update-download-progress', {
      downloaded,
      total,
      percent: total ? Math.round((downloaded / total) * 100) : 0,
      fileName: asset.name,
    });
  });

  await pipeline(body, createWriteStream(filePath));
  mainWindow?.webContents.send('bzxz:update-download-progress', {
    downloaded: total || downloaded,
    total: total || downloaded,
    percent: 100,
    fileName: asset.name,
    done: true,
  });

  const openError = await shell.openPath(filePath);
  if (openError) {
    throw new Error(`启动安装包失败: ${openError}`);
  }

  setTimeout(() => {
    isQuitting = true;
    app.quit();
  }, 1200);

  return {
    latestVersion: info.latestVersion,
    installerPath: filePath,
    fileName: asset.name,
  };
}

function pickWebAccessUrl(url?: string): string {
  const info = getWebAccessInfo();
  const allowed = [info.localUrl, ...info.lanUrls];
  return url && allowed.includes(url) ? url : info.primaryUrl;
}

function isLocalRequest(req: Request): boolean {
  const remote = req.socket.remoteAddress || req.ip || '';
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) || remote.startsWith('::ffff:127.');
}

function webAccessGate(req: Request, res: Response, next: NextFunction) {
  if (loadSettings().webServiceEnabled || isLocalRequest(req)) {
    next();
    return;
  }
  res.status(403).send('bzxz Web access is disabled on this desktop host.');
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

  // Start minimized to tray — user opens window via tray menu or double-click
  const windowWithMinimizeEvent = mainWindow as unknown as {
    on(event: 'minimize', listener: (event: { preventDefault(): void }) => void): void;
  };
  windowWithMinimizeEvent.on('minimize', (event) => {
    if (process.platform !== 'darwin') {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting && process.platform !== 'darwin') {
      event.preventDefault();
      mainWindow?.hide();
    }
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
  updateTrayMenu();

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}

function updateTrayMenu() {
  if (!tray) return;
  const accessInfo = getWebAccessInfo();

  const contextMenu = Menu.buildFromTemplate([
    { label: '打开 bzxz', click: () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      } else {
        createWindow();
      }
    }},
    { label: '在浏览器打开网页版', click: () => {
      void shell.openExternal(accessInfo.localUrl);
    }},
    { label: accessInfo.webServiceEnabled && accessInfo.lanUrls[0] ? `复制局域网地址: ${accessInfo.lanUrls[0]}` : '局域网访问已关闭', enabled: accessInfo.webServiceEnabled && accessInfo.lanUrls.length > 0, click: () => {
      clipboard.writeText(accessInfo.lanUrls[0]);
    }},
    { type: 'separator' },
    { label: '退出', click: () => {
      isQuitting = true;
      app.quit();
    }},
  ]);

  tray.setToolTip(`bzxz · ${accessInfo.primaryUrl}`);
  tray.setContextMenu(contextMenu);
}

async function startServer(): Promise<number> {
  // app.getAppPath() = app.asar in packed, project root in dev
  // process.resourcesPath = resources/ dir in packed, undefined in dev
  const baseDir = (process as any).resourcesPath
    ? (process as any).resourcesPath // resources/ dir where extraResources live
    : process.cwd();

  process.env.BZXZ_BASE_DIR = baseDir;
  await ensureDataDirs();

  const expressApp = express();
  expressApp.use(webAccessGate);
  expressApp.use(createApp());
  return new Promise((resolve) => {
    const server = expressApp.listen(0, '0.0.0.0', () => {  // 0 = random available port
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 3000;
      resolve(port);
    });
  });
}

app.whenReady().then(async () => {
  serverPort = await startServer();
  console.log(`Server on http://localhost:${serverPort}`);

  // Force Chromium to bypass system proxy
  session.defaultSession.setProxy({ mode: 'direct' });

  // Download interception — auto-save to configured path, no dialog
  const settings = loadSettings();
  if (!existsSync(settings.downloadPath)) mkdirSync(settings.downloadPath, { recursive: true });

  session.defaultSession.on('will-download', (_event, item) => {
    const filePath = path.join(loadSettings().downloadPath, item.getFilename());
    item.setSavePath(filePath);
  });

  // IPC: get/set download path
  ipcMain.handle('bzxz:get-download-path', () => loadSettings().downloadPath);
  ipcMain.handle('bzxz:set-download-path', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择默认下载路径', properties: ['openDirectory', 'createDirectory'],
    });
    if (!result.canceled && result.filePaths[0]) {
      const currentSettings = loadSettings();
      currentSettings.downloadPath = result.filePaths[0];
      saveSettings(currentSettings);
    }
    return loadSettings().downloadPath;
  });
  ipcMain.handle('bzxz:open-download-folder', () => {
    void shell.openPath(loadSettings().downloadPath);
  });
  ipcMain.handle('bzxz:get-open-at-login', () => getOpenAtLoginInfo());
  ipcMain.handle('bzxz:set-open-at-login', (_event, enabled: boolean) => setOpenAtLogin(Boolean(enabled)));
  ipcMain.handle('bzxz:get-web-access-info', () => getWebAccessInfo());
  ipcMain.handle('bzxz:set-web-service-enabled', (_event, enabled: boolean) => setWebServiceEnabled(Boolean(enabled)));
  ipcMain.handle('bzxz:get-app-version', () => app.getVersion());
  ipcMain.handle('bzxz:check-for-updates', () => checkForUpdates());
  ipcMain.handle('bzxz:download-and-install-update', () => downloadAndInstallUpdate());
  ipcMain.handle('bzxz:open-update-page', (_event, url?: string) => {
    const target = typeof url === 'string' && url.startsWith('https://github.com/') ? url : UPDATE_RELEASES_URL;
    void shell.openExternal(target);
    return { url: target };
  });
  ipcMain.handle('bzxz:copy-web-access-url', (_event, url?: string) => {
    const target = pickWebAccessUrl(url);
    clipboard.writeText(target);
    return { url: target };
  });
  ipcMain.handle('bzxz:open-web-access-url', (_event, url?: string) => {
    const target = pickWebAccessUrl(url);
    void shell.openExternal(target);
    return { url: target };
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
  isQuitting = true;
  tray?.destroy();
  tray = null;
});
