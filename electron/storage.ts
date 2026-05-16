// storage.ts - Persistencia simple basada en un JSON en userData.
//
// La terminal guarda:
//   - deviceToken: JWT emitido por POST /pos-licenses/activate
//   - branch:      datos minimos de la sucursal asociada
//   - license:     id + key + label de la licencia activa
//
// Se serializa todo a un archivo "session.json" dentro de userData (path estandar
// de Electron por SO). No uso electron-store para no agregar deps; la API expuesta
// al renderer via preload es deliberadamente minima.

import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface StoredSession {
  deviceToken: string;
  expiresAt: number;
  license: {
    id: string;
    licenseKey: string;
    label?: string;
    status: string;
    activatedAt: string;
  };
  branch: {
    id: string;
    code: string;
    name: string;
    timezone?: string;
    currencyCode?: string;
    ticketName?: string;
  };
}

function getSessionFilePath(): string {
  return path.join(app.getPath('userData'), 'session.json');
}

export function loadSession(): StoredSession | null {
  try {
    const filePath = getSessionFilePath();
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed.deviceToken || !parsed.license?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession): void {
  const filePath = getSessionFilePath();
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
}

export function clearSession(): void {
  try {
    const filePath = getSessionFilePath();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore
  }
}
