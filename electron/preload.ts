import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('siaiDesktop', {
  platform: process.platform,
  electronVersion: process.versions.electron,
  savePdf: (html: string, defaultFileName: string) => ipcRenderer.invoke('siai:save-pdf', { html, defaultFileName }),
  saveExcel: (content: string, defaultFileName: string) => ipcRenderer.invoke('siai:save-excel', { content, defaultFileName }),
});
