import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('siaiDesktop', {
  platform: process.platform,
  electronVersion: process.versions.electron,
});
