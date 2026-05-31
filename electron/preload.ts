import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('bzxz', {
  platform: process.platform,
  isElectron: true,
  getDownloadPath: () => ipcRenderer.invoke('bzxz:get-download-path'),
  setDownloadPath: () => ipcRenderer.invoke('bzxz:set-download-path'),
  openDownloadFolder: () => ipcRenderer.invoke('bzxz:open-download-folder'),
  getOpenAtLogin: () => ipcRenderer.invoke('bzxz:get-open-at-login'),
  setOpenAtLogin: (enabled: boolean) => ipcRenderer.invoke('bzxz:set-open-at-login', enabled),
  getWebAccessInfo: () => ipcRenderer.invoke('bzxz:get-web-access-info'),
  setWebServiceEnabled: (enabled: boolean) => ipcRenderer.invoke('bzxz:set-web-service-enabled', enabled),
  getAppVersion: () => ipcRenderer.invoke('bzxz:get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('bzxz:check-for-updates'),
  downloadAndInstallUpdate: () => ipcRenderer.invoke('bzxz:download-and-install-update'),
  openUpdatePage: (url?: string) => ipcRenderer.invoke('bzxz:open-update-page', url),
  getGithubProxies: () => ipcRenderer.invoke('bzxz:get-github-proxies'),
  setGithubProxies: (proxies: string[]) => ipcRenderer.invoke('bzxz:set-github-proxies', proxies),
  onUpdateDownloadProgress: (callback: (progress: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress);
    ipcRenderer.on('bzxz:update-download-progress', listener);
    return () => ipcRenderer.removeListener('bzxz:update-download-progress', listener);
  },
  copyWebAccessUrl: (url?: string) => ipcRenderer.invoke('bzxz:copy-web-access-url', url),
  openWebAccessUrl: (url?: string) => ipcRenderer.invoke('bzxz:open-web-access-url', url),
  getPortConfig: () => ipcRenderer.invoke('bzxz:get-port-config'),
  setPortConfig: (port: number | null) => ipcRenderer.invoke('bzxz:set-port-config', port),
  checkPort: (port: number) => ipcRenderer.invoke('bzxz:check-port', port),
  relaunchApp: () => ipcRenderer.invoke('bzxz:relaunch-app'),
});
