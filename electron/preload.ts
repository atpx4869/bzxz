import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('bzxz', {
  platform: process.platform,
  isElectron: true,
});
