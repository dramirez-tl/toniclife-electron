// main.ts - Entry point del proceso main de Electron.
//
// Responsabilidades:
//   - Crear la ventana del POS (fullscreen-ready, sin menu de chrome dev).
//   - Registrar handlers IPC: hardware fingerprint + persistencia de sesion.
//   - Aplicar reglas de seguridad: contextIsolation, nodeIntegration off.
//   - En dev: cargar Vite dev server. En prod: cargar el build estatico.

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeHardwareFingerprint } from './hardware';
import { loadSession, saveSession, clearSession, type StoredSession } from './storage';
import {
  loadPrinterConfig,
  savePrinterConfig,
  testPrint,
  printCorte,
  openCashDrawer,
  listOsPrinters,
  type PrinterConfig,
} from './printer';
import type { CorteReceiptInput } from './receipts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// VITE_DEV_SERVER_URL es inyectado por vite-plugin-electron en dev.
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(__dirname, '..', 'dist');

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    title: 'Tonic Life POS',
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#3E667D',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // necesario para que el preload use node:os
    },
  });

  // Abrir maximizada (POS de mostrador). El 1280x800 queda como tamaño al restaurar.
  mainWindow.maximize();

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ============================================================================
// IPC HANDLERS
// ============================================================================

ipcMain.handle('hw:get', () => computeHardwareFingerprint());

ipcMain.handle('session:load', () => loadSession());

ipcMain.handle('session:save', (_evt, session: StoredSession) => {
  saveSession(session);
});

ipcMain.handle('session:clear', () => {
  clearSession();
});

ipcMain.handle('window:setTitle', (_evt, title: string) => {
  if (mainWindow) mainWindow.setTitle(title);
});

ipcMain.handle('window:close', () => {
  if (mainWindow) mainWindow.close();
});

// Diagnostico: ruta donde Electron guarda la sesion (session.json) y la
// configuracion de la impresora (printer.json).
ipcMain.handle('app:getUserDataPath', () => app.getPath('userData'));

// ----- Impresora termica -----

ipcMain.handle('printer:list', () => listOsPrinters(mainWindow));
ipcMain.handle('printer:loadConfig', () => loadPrinterConfig());
ipcMain.handle('printer:saveConfig', (_evt, config: PrinterConfig) => {
  savePrinterConfig(config);
});
ipcMain.handle(
  'printer:testPrint',
  async (_evt, config: PrinterConfig, branchName: string) => {
    try {
      await testPrint(config, branchName);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
);
ipcMain.handle(
  'printer:openCashDrawer',
  async (_evt, config: PrinterConfig) => {
    try {
      await openCashDrawer(config);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
);
ipcMain.handle(
  'printer:printCorte',
  async (_evt, corte: Omit<CorteReceiptInput, 'paperWidth'>) => {
    try {
      await printCorte(corte);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
);

// ============================================================================
// APP LIFECYCLE
// ============================================================================

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
