// Force direct connection — bypass any system proxy (Clash, etc.)
for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
  delete (process.env as Record<string, string | undefined>)[key];
}
process.env.NO_PROXY = '*';

// Capture early server-side warnings into the diagnostics buffer.
import '../src/shared/log-buffer';

import { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain, session, shell, clipboard } from 'electron';

Menu.setApplicationMenu(null);
import path from 'node:path';
import net from 'node:net';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, cpSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
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
  /** User-preferred HTTP port. null/0 = pick a random free port at startup. */
  preferredPort: number | null;
}

// Reserved/well-known port floor — refuse anything below this so the user
// doesn't accidentally collide with system services (and on non-admin Windows
// binding under 1024 quietly fails anyway).
const MIN_USER_PORT = 1024;
const MAX_USER_PORT = 65535;

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
    downloadPath: path.join(app.getPath('desktop'), 'bzxz'),
    webServiceEnabled: true,
    preferredPort: null,
  };
}

function normalizePreferredPort(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n)) return null;
  if (n < MIN_USER_PORT || n > MAX_USER_PORT) return null;
  return n;
}

/** Check if a TCP port is bindable on 0.0.0.0 right now. */
function checkPortAvailable(port: number): Promise<{ available: boolean; error?: string }> {
  return new Promise((resolve) => {
    const tester = net.createServer();
    let settled = false;
    const done = (result: { available: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      tester.removeAllListeners();
      try { tester.close(); } catch { /* ignore */ }
      resolve(result);
    };
    tester.once('error', (err: NodeJS.ErrnoException) => {
      const msg = err.code === 'EADDRINUSE' ? '端口已被占用'
        : err.code === 'EACCES' ? '权限不足，无法绑定该端口'
        : (err.message || '端口不可用');
      done({ available: false, error: msg });
    });
    tester.once('listening', () => {
      done({ available: true });
    });
    try {
      tester.listen(port, '0.0.0.0');
    } catch (err) {
      done({ available: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
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
      ? '同一局域网设备访问前，请允许 Windows 防火墙放行 标准盒子 或当前端口。'
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

// Limit asset download host to GitHub's own infrastructure. GitHub release downloads
// either come directly from api.github.com / github.com or are redirected to
// objects.githubusercontent.com (the asset CDN). Any other host is rejected.
const TRUSTED_UPDATE_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

function assertTrustedUpdateHost(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('安装包下载地址无效');
  }
  if (parsed.protocol !== 'https:' || !TRUSTED_UPDATE_HOSTS.has(parsed.hostname)) {
    throw new Error(`拒绝从非可信主机下载更新: ${parsed.hostname}`);
  }
  return parsed;
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
  assertTrustedUpdateHost(asset.url);

  const updateDir = path.join(app.getPath('temp'), 'bzxz-updates');
  if (!existsSync(updateDir)) mkdirSync(updateDir, { recursive: true });
  const filePath = path.join(updateDir, safeDownloadFileName(asset.name));

  const response = await fetch(asset.url, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': `bzxz/${app.getVersion()}`,
    },
    redirect: 'follow',
  });
  if (!response.ok || !response.body) {
    throw new Error(`下载安装包失败: HTTP ${response.status}`);
  }
  // After redirects, response.url is the final URL — verify it's still a trusted host.
  assertTrustedUpdateHost(response.url);

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

  // The Release API gives us the authoritative asset size — reject mismatched downloads.
  if (asset.size > 0 && downloaded !== asset.size) {
    try { await unlink(filePath); } catch { /* best-effort cleanup */ }
    throw new Error(`安装包大小校验失败: 期望 ${asset.size} 字节，实际 ${downloaded} 字节`);
  }

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
  res.status(403).send('标准盒子 / StandardsBox web access is disabled on this desktop host.');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: '标准盒子 · StandardsBox',
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
    { label: '打开 标准盒子', click: () => {
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

  tray.setToolTip(`标准盒子 · ${accessInfo.primaryUrl}`);
  tray.setContextMenu(contextMenu);
}

/**
 * Resolve the directory under which we store all persistent user data
 * (data/bzxz.db, data/exports/, etc.).
 *
 *   - Portable build: ${PORTABLE_EXECUTABLE_DIR} — the folder the .exe sits in
 *   - NSIS installed: the install directory (parent of the .exe)
 *   - Dev mode:        the project root (process.cwd())
 *
 * This keeps user-customizable data next to the program itself, so moving or
 * relocating the install folder also moves the data.
 */
function resolveInstallDir(): string {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (app.isPackaged) return path.dirname(app.getPath('exe'));
  return process.cwd();
}

/**
 * One-time migration: pre-1.x builds wrote data/bzxz.db underneath
 * `<install>/resources/`. We now store it directly under `<install>/`, so on
 * first launch after upgrade copy the old folder over if the new one is empty.
 */
function migrateLegacyDataDir(installDir: string): void {
  try {
    const newDir = path.join(installDir, 'data');
    const legacyDir = path.join((process as any).resourcesPath || '', 'data');
    if (!legacyDir || legacyDir === newDir) return;
    if (!existsSync(legacyDir)) return;
    // Only migrate when the new dir is missing or empty.
    if (existsSync(newDir)) {
      try {
        if (readdirSync(newDir).length > 0) return;
      } catch { return; }
    }
    cpSync(legacyDir, newDir, { recursive: true });
    console.log(`[bzxz] migrated legacy data dir ${legacyDir} → ${newDir}`);
  } catch (err) {
    console.warn('[bzxz] legacy data migration failed:', err);
  }
}

async function startServer(): Promise<number> {
  const installDir = resolveInstallDir();
  if (app.isPackaged) migrateLegacyDataDir(installDir);

  process.env.BZXZ_BASE_DIR = installDir;
  // public/ and scripts/ live alongside the packed app via extraResources;
  // in dev they're at the project root (same as installDir).
  process.env.BZXZ_STATIC_DIR = app.isPackaged
    ? ((process as any).resourcesPath as string)
    : installDir;
  process.env.BZXZ_APP_VERSION = app.getVersion();
  await ensureDataDirs();

  const expressApp = express();
  expressApp.use(webAccessGate);
  expressApp.use(createApp());

  const preferred = loadSettings().preferredPort;

  // Try the user-preferred port first if configured; on EADDRINUSE/EACCES
  // fall back to a random free port so the desktop app always boots. The
  // tray/UI surface both the configured value and the actual one.
  const tryListen = (port: number): Promise<{ port: number; usedFallback: boolean }> => new Promise((resolve, reject) => {
    const server = expressApp.listen(port, '0.0.0.0');
    server.once('listening', () => {
      const addr = server.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      resolve({ port: actual, usedFallback: false });
    });
    server.once('error', (err: NodeJS.ErrnoException) => {
      try { server.close(); } catch { /* ignore */ }
      reject(err);
    });
  });

  if (preferred && preferred > 0) {
    try {
      const r = await tryListen(preferred);
      return r.port;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      console.warn(`[bzxz] preferred port ${preferred} unavailable (${code || 'error'}); falling back to a random port`);
    }
  }
  const r = await tryListen(0); // 0 = random available
  return r.port;
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

  // ── Port configuration ─────────────────────────────────────────────────
  // `preferredPort` is what the user typed; `actualPort` is what we actually
  // bound to (they differ when the preferred port was busy at boot and we
  // fell back to a random one). UI surfaces both so users aren't confused.
  ipcMain.handle('bzxz:get-port-config', () => {
    const settings = loadSettings();
    return {
      preferredPort: settings.preferredPort,
      actualPort: serverPort,
      minPort: MIN_USER_PORT,
      maxPort: MAX_USER_PORT,
    };
  });
  ipcMain.handle('bzxz:check-port', async (_event, port: unknown) => {
    const n = normalizePreferredPort(port);
    if (n === null) {
      return { available: false, error: '端口范围必须在 1024 - 65535 之间', port: null };
    }
    // The current bzxz server is already listening on serverPort, so checking
    // its own port would always return "in use". Treat that case as a no-op.
    if (n === serverPort) {
      return { available: true, port: n, note: '当前已在使用此端口' };
    }
    const result = await checkPortAvailable(n);
    return { ...result, port: n };
  });
  ipcMain.handle('bzxz:set-port-config', (_event, port: unknown) => {
    const settings = loadSettings();
    settings.preferredPort = normalizePreferredPort(port);
    saveSettings(settings);
    return {
      preferredPort: settings.preferredPort,
      actualPort: serverPort,
      needsRestart: settings.preferredPort !== null && settings.preferredPort !== serverPort,
    };
  });
  ipcMain.handle('bzxz:relaunch-app', () => {
    isQuitting = true;
    app.relaunch();
    app.exit(0);
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
