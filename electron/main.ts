import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const DEV_URL = 'http://127.0.0.1:5173';
const MAX_REPORT_HTML_CHARS = 8_000_000;
const MAX_SPREADSHEET_CHARS = 12_000_000;

function safeFileName(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
  return cleaned || fallback;
}

function registerExportHandlers(): void {
  ipcMain.handle('siai:save-pdf', async (_event, payload: unknown) => {
    const row = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const html = typeof row.html === 'string' ? row.html : '';
    const defaultFileName = safeFileName(typeof row.defaultFileName === 'string' ? row.defaultFileName : '', 'informe-siai.pdf');
    if (!html || html.length > MAX_REPORT_HTML_CHARS) throw new Error('El contenido del informe PDF es inválido o demasiado grande.');

    const result = await dialog.showSaveDialog({
      title: 'Guardar informe SIAI en PDF',
      defaultPath: defaultFileName.toLowerCase().endsWith('.pdf') ? defaultFileName : `${defaultFileName}.pdf`,
      filters: [{ name: 'Documento PDF', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true, filePath: null };

    const tempPath = path.join(app.getPath('temp'), `siai-report-${randomUUID()}.html`);
    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });

    printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    printWindow.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith('file://')) event.preventDefault();
    });

    try {
      await fs.writeFile(tempPath, html, 'utf8');
      await printWindow.loadFile(tempPath);
      const pdf = await printWindow.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        pageSize: 'A4',
      });
      await fs.writeFile(result.filePath, pdf);
      return { canceled: false, filePath: result.filePath };
    } finally {
      if (!printWindow.isDestroyed()) printWindow.destroy();
      await fs.unlink(tempPath).catch(() => undefined);
    }
  });

  ipcMain.handle('siai:save-excel', async (_event, payload: unknown) => {
    const row = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const content = typeof row.content === 'string' ? row.content : '';
    const defaultFileName = safeFileName(typeof row.defaultFileName === 'string' ? row.defaultFileName : '', 'informe-siai.xls');
    if (!content || content.length > MAX_SPREADSHEET_CHARS) throw new Error('El contenido del informe Excel es inválido o demasiado grande.');

    const result = await dialog.showSaveDialog({
      title: 'Guardar informe SIAI para Excel',
      defaultPath: defaultFileName.toLowerCase().endsWith('.xls') ? defaultFileName : `${defaultFileName}.xls`,
      filters: [{ name: 'Microsoft Excel 2003 XML', extensions: ['xls'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true, filePath: null };

    await fs.writeFile(result.filePath, `\uFEFF${content}`, 'utf8');
    return { canceled: false, filePath: result.filePath };
  });
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#f4f7fb',
    title: 'SIAI - ITSQMET',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.once('ready-to-show', () => window.show());

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    const isAllowed = app.isPackaged ? url.startsWith('file://') : url.startsWith(DEV_URL);
    if (!isAllowed) {
      event.preventDefault();
      if (url.startsWith('https://') || url.startsWith('http://')) {
        void shell.openExternal(url);
      }
    }
  });

  if (app.isPackaged) {
    await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  } else {
    await window.loadURL(DEV_URL);
  }
}

app.whenReady().then(() => {
  registerExportHandlers();
  void createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
