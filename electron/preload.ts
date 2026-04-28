import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('bzxz', {
  platform: process.platform,
  isElectron: true,
  getDownloadPath: () => ipcRenderer.invoke('bzxz:get-download-path'),
  setDownloadPath: () => ipcRenderer.invoke('bzxz:set-download-path'),
  openDownloadFolder: () => ipcRenderer.invoke('bzxz:open-download-folder'),
});
