// desktopShortcut.ts - Reparación del acceso directo con la versión en el
// nombre ("Tonic Life POS v2.1.0", build.nsis.shortcutName).
//
// POR QUÉ (10-nov-2026): al actualizar, el instalador solo renombra el acceso
// que la versión anterior dejó ANOTADO en el registro (ShortcutName). Si ese
// renombrado falla una sola vez, el registro avanza y el archivo no: el acceso
// se queda para siempre con una versión vieja aunque el programa sí se
// actualice (escritorio "v2.0.81" con el POS en 2.1.0; el del menú Inicio sí
// decía v2.1.0). El POS lo repara al arrancar: deja UN acceso con la versión
// instalada. Nunca crea uno donde no había (si el cajero lo borró, se respeta)
// ni toca accesos que no apunten a este programa.
//
// Sin Electron: la decisión es pura y el disco se inyecta, para probarla.

import fs from 'node:fs';
import path from 'node:path';

export interface ShortcutPlan {
  /** Acceso viejo que pasa a llamarse como la versión instalada. */
  rename: { from: string; to: string } | null;
  /** Accesos viejos que sobran (ya hay uno con la versión instalada). */
  remove: string[];
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "2.0.81" → [2, 0, 81] para ordenar versiones. */
function versionParts(version: string): number[] {
  return version.split('.').map((n) => parseInt(n, 10) || 0);
}

function compareVersions(a: string, b: string): number {
  const x = versionParts(a);
  const y = versionParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Nombre del acceso de una versión: "Tonic Life POS v2.1.0.lnk". */
export function shortcutFileName(productName: string, version: string): string {
  return `${productName} v${version}.lnk`;
}

/**
 * Versión que anuncia un acceso directo NUESTRO ("<producto> v<números>.lnk")
 * o null si el archivo no tiene ese nombre exacto.
 */
export function shortcutVersion(fileName: string, productName: string): string | null {
  const m = new RegExp(`^${escapeRegExp(productName)} v(\\d+(?:\\.\\d+)*)\\.lnk$`, 'i').exec(fileName);
  return m ? m[1] : null;
}

/**
 * Qué hacer con los accesos de una carpeta para que quede uno solo con la
 * versión instalada. `files` = accesos ya verificados (apuntan a este exe).
 */
export function planShortcutRepair(
  files: readonly string[],
  productName: string,
  version: string,
): ShortcutPlan {
  const target = shortcutFileName(productName, version);
  const isTarget = (f: string) => f.toLowerCase() === target.toLowerCase();
  const stale = files
    .filter((f) => !isTarget(f) && shortcutVersion(f, productName) !== null)
    .sort((a, b) =>
      compareVersions(shortcutVersion(b, productName)!, shortcutVersion(a, productName)!),
    );
  if (stale.length === 0) return { rename: null, remove: [] };
  // Ya existe el de esta versión: los viejos son duplicados.
  if (files.some(isTarget)) return { rename: null, remove: stale };
  // El más reciente se renombra; cualquier otro más viejo sobra.
  const [newest, ...rest] = stale;
  return { rename: { from: newest, to: target }, remove: rest };
}

export interface ShortcutRepairDeps {
  productName: string;
  version: string;
  /** Ruta del ejecutable instalado (process.execPath). */
  exePath: string;
  /** Destino de un .lnk (shell.readShortcutLink); null si no se pudo leer. */
  readTarget: (shortcutPath: string) => string | null;
  log?: (line: string) => void;
}

const samePath = (a: string, b: string) =>
  path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase();

/**
 * Repara los accesos de UNA carpeta (escritorio o menú Inicio). Nunca lanza:
 * un fallo (carpeta sin permisos, archivo bloqueado) se anota y se reintenta
 * en el siguiente arranque. Devuelve lo que sí hizo.
 */
export function repairShortcutsIn(dir: string, deps: ShortcutRepairDeps): ShortcutPlan {
  const done: ShortcutPlan = { rename: null, remove: [] };
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return done;
  }
  // Solo accesos con NUESTRO nombre que además apunten a ESTE programa.
  const ours = names.filter((name) => {
    if (shortcutVersion(name, deps.productName) === null) return false;
    const target = deps.readTarget(path.join(dir, name));
    return !!target && samePath(target, deps.exePath);
  });
  const plan = planShortcutRepair(ours, deps.productName, deps.version);
  if (plan.rename) {
    try {
      fs.renameSync(path.join(dir, plan.rename.from), path.join(dir, plan.rename.to));
      done.rename = plan.rename;
      deps.log?.(`acceso directo: "${plan.rename.from}" → "${plan.rename.to}" (${dir})`);
    } catch (err) {
      deps.log?.(
        `acceso directo: no se pudo renombrar "${plan.rename.from}": ${err instanceof Error ? err.message : String(err)}`,
      );
      // Sin el renombrado no se borra nada: se reintenta al siguiente arranque.
      return done;
    }
  }
  for (const name of plan.remove) {
    try {
      fs.unlinkSync(path.join(dir, name));
      done.remove.push(name);
      deps.log?.(`acceso directo: se quitó el duplicado viejo "${name}" (${dir})`);
    } catch (err) {
      deps.log?.(
        `acceso directo: no se pudo quitar "${name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return done;
}
