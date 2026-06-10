// storage.ts - Persistencia de la sesion del POS en userData.
//
// La terminal guarda:
//   - deviceToken: JWT emitido por POST /pos-licenses/activate
//   - branch:      datos minimos de la sucursal asociada
//   - license:     id + key + label de la licencia activa
//
// El deviceToken es una credencial de larga vida: se persiste CIFRADO con
// safeStorage (DPAPI en Windows, Keychain en macOS) en "session.bin". Si el
// SO no ofrece cifrado (Linux sin keyring), se cae a JSON plano como antes.
// Las instalaciones viejas con "session.json" plano se migran a cifrado en
// el primer load.

import { app, safeStorage } from 'electron';
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

function getEncryptedFilePath(): string {
  return path.join(app.getPath('userData'), 'session.bin');
}

function getLegacyFilePath(): string {
  return path.join(app.getPath('userData'), 'session.json');
}

function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function parseSession(raw: string): StoredSession | null {
  try {
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed.deviceToken || !parsed.license?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function loadSession(): StoredSession | null {
  // 1) Archivo cifrado (formato actual)
  try {
    const encPath = getEncryptedFilePath();
    if (fs.existsSync(encPath) && canEncrypt()) {
      const raw = safeStorage.decryptString(fs.readFileSync(encPath));
      const session = parseSession(raw);
      if (session) return session;
    }
  } catch {
    // archivo corrupto o cifrado por otro usuario del SO: tratar como sin sesion
  }

  // 2) Legacy en texto plano: migrar a cifrado y borrar el plano
  try {
    const legacyPath = getLegacyFilePath();
    if (!fs.existsSync(legacyPath)) return null;
    const session = parseSession(fs.readFileSync(legacyPath, 'utf-8'));
    if (!session) return null;
    if (canEncrypt()) {
      saveSession(session);
      fs.unlinkSync(legacyPath);
    }
    return session;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession): void {
  const json = JSON.stringify(session);
  if (canEncrypt()) {
    fs.writeFileSync(getEncryptedFilePath(), safeStorage.encryptString(json));
    return;
  }
  // Fallback sin cifrado disponible (Linux sin keyring): comportamiento previo
  fs.writeFileSync(getLegacyFilePath(), json, 'utf-8');
}

export function clearSession(): void {
  for (const filePath of [getEncryptedFilePath(), getLegacyFilePath()]) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
  }
}
