// main.ts - Entry point del proceso main de Electron.
//
// Responsabilidades:
//   - Crear la ventana del POS (fullscreen-ready, sin menu de chrome dev).
//   - Registrar handlers IPC: hardware fingerprint + persistencia de sesion.
//   - Aplicar reglas de seguridad: contextIsolation, nodeIntegration off.
//   - En dev: cargar Vite dev server. En prod: cargar el build estatico.

import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeHardwareFingerprint } from './hardware';
import { setupAutoUpdater } from './updater';
import { loadSession, saveSession, clearSession, type StoredSession } from './storage';
import {
  loadPrinterConfig,
  savePrinterConfig,
  testPrint,
  printCorte,
  printSale,
  openCashDrawer,
  listOsPrinters,
  type PrinterConfig,
} from './printer';
import { warmUpRawPrinter, disposeRawPrinterWorker } from './printraw';
import type { CorteReceiptInput, SaleReceiptInput } from './receipts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Dev y app INSTALADA no comparten estado (sesión/licencia/impresora): en dev
// el userData lleva sufijo -dev. Sin esto, en la máquina de desarrollo ambas
// leen el mismo session.bin y un "Cerrar sesión" en dev liberaría la licencia
// de la instalación real (y viceversa).
if (!app.isPackaged) {
  app.setPath('userData', `${app.getPath('userData')}-dev`);
}

// VITE_DEV_SERVER_URL es inyectado por vite-plugin-electron en dev.
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(__dirname, '..', 'dist');

let mainWindow: BrowserWindow | null = null;

// ============================================================================
// SINGLE INSTANCE + LOG DE ERRORES
// ============================================================================

// Dos instancias del POS = dos sesiones de caja/heartbeats compitiendo. La
// segunda instancia sale de inmediato y la primera recupera el foco.
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Errores no capturados del proceso main: log a archivo (userData/logs) para
// poder diagnosticar caídas en sucursal sin DevTools. No se relanza la app.
function logFatal(kind: string, err: unknown): void {
  try {
    const logsDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const msg =
      err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    fs.appendFileSync(
      path.join(logsDir, 'main.log'),
      `[${new Date().toISOString()}] ${kind}: ${msg}\n`,
      'utf-8',
    );
  } catch {
    // sin permisos de escritura: no hay nada más que hacer
  }
  console.error(`[main] ${kind}:`, err);
}

process.on('uncaughtException', (err) => logFatal('uncaughtException', err));
process.on('unhandledRejection', (reason) =>
  logFatal('unhandledRejection', reason),
);

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

  // ESCALA ADAPTATIVA para pantallas chicas (ej. monitores 1280x1024 5:4 de
  // sucursal): la UI está diseñada para ~1440px+ de ancho; en ventanas más
  // angostas todo se ve "grande y amontonado" (header encimado, 1.5 columnas
  // de catálogo). Se aplica un zoom proporcional (ancho/1440, piso 0.78) para
  // que una pantalla de 1280 se vea como una de 1440. En pantallas grandes el
  // zoom es exactamente 1.0 — no cambia nada.
  const applyAdaptiveZoom = () => {
    const win = mainWindow;
    if (!win || win.isDestroyed()) return;
    const [width] = win.getContentSize();
    const zoom = Math.min(1, Math.max(0.78, width / 1440));
    win.webContents.setZoomFactor(zoom);
  };
  let zoomTimer: NodeJS.Timeout | null = null;
  const applyAdaptiveZoomDebounced = () => {
    if (zoomTimer) clearTimeout(zoomTimer);
    zoomTimer = setTimeout(applyAdaptiveZoom, 120);
  };
  mainWindow.webContents.on('did-finish-load', applyAdaptiveZoom);
  mainWindow.on('resize', applyAdaptiveZoomDebounced);
  mainWindow.on('maximize', applyAdaptiveZoomDebounced);
  mainWindow.on('unmaximize', applyAdaptiveZoomDebounced);

  // Menú contextual (clic derecho) en campos de texto: Electron NO trae uno
  // por defecto, así que "pegar" con el mouse no existía — el cajero copiaba
  // un número de distribuidor y no podía pegarlo en el buscador. Cortar/
  // Copiar/Pegar en cualquier input editable; Copiar sobre texto seleccionado.
  mainWindow.webContents.on('context-menu', (_event, params) => {
    if (params.isEditable) {
      Menu.buildFromTemplate([
        { label: 'Cortar', role: 'cut', enabled: params.editFlags.canCut },
        { label: 'Copiar', role: 'copy', enabled: params.editFlags.canCopy },
        { label: 'Pegar', role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        {
          label: 'Seleccionar todo',
          role: 'selectAll',
          enabled: params.editFlags.canSelectAll,
        },
      ]).popup();
    } else if (params.selectionText.trim()) {
      Menu.buildFromTemplate([{ label: 'Copiar', role: 'copy' }]).popup();
    }
  });

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
  // Si acaban de configurar impresora de sistema, dejar el worker RAW listo
  // para que el primer ticket no pague el arranque.
  if (config.connection === 'system') warmUpRawPrinter();
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
ipcMain.handle(
  'printer:printSale',
  async (
    _evt,
    sale: Omit<SaleReceiptInput, 'paperWidth'>,
    openDrawer: boolean,
  ) => {
    try {
      await printSale(sale, !!openDrawer);
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

  // Auto-actualización (solo empaquetado; en dev es no-op con log).
  setupAutoUpdater(() => mainWindow);

  // Impresora de sistema configurada: precalentar el worker RAW (arranque de
  // PowerShell + compilación del C#) para que el PRIMER ticket salga rápido.
  if (loadPrinterConfig()?.connection === 'system') warmUpRawPrinter();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('quit', () => {
  disposeRawPrinterWorker();
});
