// outbox.ts - Cola local de ventas de la terminal ("primero se guarda, luego
// se envía"). Si la red falla a media venta, el renderer deja aquí el intento
// completo (carrito, pagos, clave de idempotencia, hora real) y lo sincroniza
// después; el archivo vive en userData junto a la sesión.
//
// Escritura ATÓMICA: se escribe un .tmp, se fuerza a disco (fsync) y se
// renombra sobre el archivo final (rename es atómico en NTFS y ext4), así que
// un corte de luz a media escritura deja el archivo anterior intacto. Antes
// de reemplazar se conserva una copia .bak por si el JSON final se corrompe.
// El contenido es opaco para el main process: una lista de objetos.

import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const FILE_NAME = 'sales-outbox.json';

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME);
}

function parseList(raw: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Lee la cola; si el archivo está dañado, intenta la copia .bak; si no, []. */
export function loadOutbox(): unknown[] {
  const file = filePath();
  for (const candidate of [file, `${file}.bak`]) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const list = parseList(fs.readFileSync(candidate, 'utf8'));
      if (list) return list;
    } catch {
      // siguiente candidato
    }
  }
  return [];
}

/** Reemplaza la cola completa de forma atómica. */
export function saveOutbox(records: unknown[]): void {
  const file = filePath();
  const tmp = `${file}.tmp`;
  const data = JSON.stringify(Array.isArray(records) ? records : [], null, 1);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, data, 0, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  } catch {
    // la copia de respaldo es opcional
  }
  fs.renameSync(tmp, file);
}
