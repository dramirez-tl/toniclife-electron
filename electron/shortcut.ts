// shortcut.ts - Al arrancar, deja el acceso directo del escritorio y del menú
// Inicio con la versión INSTALADA en el nombre ("Tonic Life POS v2.1.0").
// El porqué y las reglas están en src/lib/desktopShortcut.ts; aquí solo se
// conecta con Electron (rutas de Windows y lectura del destino del .lnk).
//
// Solo Windows y solo empaquetado: en desarrollo no hay instalación.

import { app, shell } from 'electron';
import path from 'node:path';
import { repairShortcutsIn } from '../src/lib/desktopShortcut';

export function repairVersionedShortcuts(log: (line: string) => void): void {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  try {
    const deps = {
      // build.productName ("Tonic Life POS"): es el nombre del .exe instalado y
      // el que usa nsis.shortcutName. app.getName() NO sirve: devuelve el
      // `name` del package.json (toniclife-electron).
      productName: path.basename(process.execPath, path.extname(process.execPath)),
      version: app.getVersion(),
      exePath: process.execPath,
      readTarget: (shortcutPath: string): string | null => {
        try {
          return shell.readShortcutLink(shortcutPath).target || null;
        } catch {
          return null;
        }
      },
      log,
    };
    const dirs = [
      // Instalación "solo para mí" (la normal): escritorio y menú del usuario.
      app.getPath('desktop'),
      path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      // Instalación "para todos los usuarios": se intenta; sin permisos solo se anota.
      path.join(process.env.PUBLIC ?? 'C:\\Users\\Public', 'Desktop'),
    ];
    for (const dir of dirs) repairShortcutsIn(dir, deps);
  } catch (err) {
    log(`acceso directo: revisión fallida: ${err instanceof Error ? err.message : String(err)}`);
  }
}
