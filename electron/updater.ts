// updater.ts - Auto-actualización del POS via electron-updater.
//
// Flujo: al arrancar (con delay para no competir con el boot) y cada 4 horas,
// la app consulta el feed de releases (package.json → build.publish). Si hay
// versión nueva la DESCARGA en silencio y avisa al renderer por IPC; el cajero
// decide cuándo reiniciar (nunca se interrumpe una venta). La instalación
// corre al reiniciar (quitAndInstall) o en el siguiente arranque de Windows.
//
// Solo corre empaquetado (app.isPackaged): en dev no hay feed ni firma.
// Los eventos quedan en userData/logs/updater.log para diagnóstico en sucursal.

import { app, ipcMain, type BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
// electron-updater es CommonJS: default import + destructuring (ESM interop).
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4h
const FIRST_CHECK_DELAY_MS = 15_000; // dejar respirar el boot/licencia

function logUpdater(line: string): void {
  try {
    const logsDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(
      path.join(logsDir, 'updater.log'),
      `[${new Date().toISOString()}] ${line}\n`,
      'utf-8',
    );
  } catch {
    /* sin permisos: seguimos sin log */
  }
  console.log(`[updater] ${line}`);
}

export function setupAutoUpdater(getWindow: () => BrowserWindow | null): void {
  // Instalar el handler SIEMPRE (aunque no esté empaquetado) para que el
  // renderer pueda llamarlo sin explotar; en dev simplemente no hace nada.
  ipcMain.handle('updater:install', () => {
    if (!app.isPackaged) return;
    logUpdater('quitAndInstall solicitado por el usuario');
    autoUpdater.quitAndInstall();
  });

  if (!app.isPackaged) {
    logUpdater('modo dev: auto-update deshabilitado');
    return;
  }

  autoUpdater.autoDownload = true;
  // Si el cajero no reinicia, la actualización queda lista y se aplica sola
  // en el siguiente cierre/arranque de la app.
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () =>
    logUpdater('buscando actualización...'),
  );
  autoUpdater.on('update-available', (info) =>
    logUpdater(`actualización disponible: v${info.version} (descargando)`),
  );
  autoUpdater.on('update-not-available', () => logUpdater('al día'));
  autoUpdater.on('error', (err) =>
    logUpdater(`error: ${err?.message ?? String(err)}`),
  );
  autoUpdater.on('update-downloaded', (info) => {
    logUpdater(`descargada v${info.version}; avisando al renderer`);
    getWindow()?.webContents.send('updater:downloaded', {
      version: info.version,
    });
  });

  const check = () => {
    autoUpdater.checkForUpdates().catch((err) => {
      // Sin red / feed caído: silencioso, el siguiente ciclo reintenta.
      logUpdater(`check falló: ${err?.message ?? String(err)}`);
    });
  };

  setTimeout(check, FIRST_CHECK_DELAY_MS);
  setInterval(check, CHECK_INTERVAL_MS);
}
