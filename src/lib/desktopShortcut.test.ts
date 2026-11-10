// desktopShortcut.test.ts - El acceso directo lleva la versión en el nombre y
// el instalador a veces lo deja con una versión vieja (escritorio "v2.0.81"
// con el POS en 2.1.0, 10-nov-2026). El POS lo repara al arrancar.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  planShortcutRepair,
  repairShortcutsIn,
  shortcutFileName,
  shortcutVersion,
} from './desktopShortcut';

const PRODUCT = 'Tonic Life POS';
const EXE = 'C:\\Users\\Caja\\AppData\\Local\\Programs\\Tonic Life POS\\Tonic Life POS.exe';

describe('nombres', () => {
  it('nombre del acceso de una versión', () => {
    expect(shortcutFileName(PRODUCT, '2.1.0')).toBe('Tonic Life POS v2.1.0.lnk');
  });

  it('solo reconoce "<producto> v<versión>.lnk"', () => {
    expect(shortcutVersion('Tonic Life POS v2.0.81.lnk', PRODUCT)).toBe('2.0.81');
    expect(shortcutVersion('tonic life pos V2.1.0.LNK', PRODUCT)).toBe('2.1.0');
    expect(shortcutVersion('Tonic Life POS.lnk', PRODUCT)).toBeNull();
    expect(shortcutVersion('Tonic Life POS v2.0.81 - copia.lnk', PRODUCT)).toBeNull();
    expect(shortcutVersion('Tonic Life POS vieja.lnk', PRODUCT)).toBeNull();
    expect(shortcutVersion('Otro programa v2.0.81.lnk', PRODUCT)).toBeNull();
    expect(shortcutVersion('Tonic Life POS v2.0.81.txt', PRODUCT)).toBeNull();
  });
});

describe('planShortcutRepair', () => {
  it('el caso real: escritorio con "v2.0.81" y el POS en 2.1.0 → se renombra', () => {
    expect(planShortcutRepair(['Tonic Life POS v2.0.81.lnk'], PRODUCT, '2.1.0')).toEqual({
      rename: { from: 'Tonic Life POS v2.0.81.lnk', to: 'Tonic Life POS v2.1.0.lnk' },
      remove: [],
    });
  });

  it('acceso ya con la versión instalada: nada que hacer', () => {
    expect(planShortcutRepair(['Tonic Life POS v2.1.0.lnk'], PRODUCT, '2.1.0')).toEqual({
      rename: null,
      remove: [],
    });
  });

  it('sin acceso (el cajero lo borró): NO se crea ninguno', () => {
    expect(planShortcutRepair([], PRODUCT, '2.1.0')).toEqual({ rename: null, remove: [] });
  });

  it('el de esta versión ya existe y además hay viejos: los viejos sobran', () => {
    expect(
      planShortcutRepair(
        ['Tonic Life POS v2.0.81.lnk', 'Tonic Life POS v2.1.0.lnk', 'Tonic Life POS v2.0.102.lnk'],
        PRODUCT,
        '2.1.0',
      ),
    ).toEqual({
      rename: null,
      remove: ['Tonic Life POS v2.0.102.lnk', 'Tonic Life POS v2.0.81.lnk'],
    });
  });

  it('varios viejos y ninguno actual: se renombra el más reciente (2.0.102 > 2.0.81 > 2.0.9) y los demás se quitan', () => {
    expect(
      planShortcutRepair(
        ['Tonic Life POS v2.0.9.lnk', 'Tonic Life POS v2.0.102.lnk', 'Tonic Life POS v2.0.81.lnk'],
        PRODUCT,
        '2.1.0',
      ),
    ).toEqual({
      rename: { from: 'Tonic Life POS v2.0.102.lnk', to: 'Tonic Life POS v2.1.0.lnk' },
      remove: ['Tonic Life POS v2.0.81.lnk', 'Tonic Life POS v2.0.9.lnk'],
    });
  });

  it('ignora lo que no es un acceso nuestro', () => {
    expect(
      planShortcutRepair(['Tonic Life POS.lnk', 'Excel.lnk', 'notas.txt'], PRODUCT, '2.1.0'),
    ).toEqual({ rename: null, remove: [] });
  });
});

describe('repairShortcutsIn (sobre una carpeta de verdad)', () => {
  let dir: string;
  let log: string[];
  /** Destino de cada acceso de la carpeta de prueba. */
  let targets: Record<string, string | null>;
  const deps = () => ({
    productName: PRODUCT,
    version: '2.1.0',
    exePath: EXE,
    readTarget: (p: string) => targets[path.basename(p)] ?? null,
    log: (line: string) => log.push(line),
  });
  const touch = (name: string, target: string | null = EXE) => {
    fs.writeFileSync(path.join(dir, name), 'lnk');
    targets[name] = target;
  };
  const list = () => fs.readdirSync(dir).sort();

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-acceso-'));
    log = [];
    targets = {};
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('renombra el acceso viejo al nombre de la versión instalada', () => {
    touch('Tonic Life POS v2.0.81.lnk');
    touch('Excel.lnk', 'C:\\Office\\excel.exe');
    const done = repairShortcutsIn(dir, deps());
    expect(done.rename).toEqual({
      from: 'Tonic Life POS v2.0.81.lnk',
      to: 'Tonic Life POS v2.1.0.lnk',
    });
    expect(list()).toEqual(['Excel.lnk', 'Tonic Life POS v2.1.0.lnk']);
    expect(log.join('\n')).toContain('v2.0.81.lnk" → "Tonic Life POS v2.1.0.lnk"');
  });

  it('es idempotente: al siguiente arranque no hace nada', () => {
    touch('Tonic Life POS v2.0.81.lnk');
    repairShortcutsIn(dir, deps());
    targets['Tonic Life POS v2.1.0.lnk'] = EXE;
    log = [];
    expect(repairShortcutsIn(dir, deps())).toEqual({ rename: null, remove: [] });
    expect(list()).toEqual(['Tonic Life POS v2.1.0.lnk']);
    expect(log).toEqual([]);
  });

  it('NO toca un acceso con nuestro nombre que apunta a otro programa o que no se puede leer', () => {
    touch('Tonic Life POS v2.0.81.lnk', 'D:\\Respaldo\\Tonic Life POS.exe');
    touch('Tonic Life POS v2.0.50.lnk', null);
    expect(repairShortcutsIn(dir, deps())).toEqual({ rename: null, remove: [] });
    expect(list()).toEqual(['Tonic Life POS v2.0.50.lnk', 'Tonic Life POS v2.0.81.lnk']);
  });

  it('la ruta del ejecutable se compara sin distinguir mayúsculas ni diagonales', () => {
    touch(
      'Tonic Life POS v2.0.81.lnk',
      'c:/users/caja/appdata/local/programs/tonic life pos/TONIC LIFE POS.EXE',
    );
    expect(repairShortcutsIn(dir, deps()).rename?.to).toBe('Tonic Life POS v2.1.0.lnk');
  });

  it('quita el duplicado viejo cuando ya está el de esta versión', () => {
    touch('Tonic Life POS v2.1.0.lnk');
    touch('Tonic Life POS v2.0.81.lnk');
    const done = repairShortcutsIn(dir, deps());
    expect(done).toEqual({ rename: null, remove: ['Tonic Life POS v2.0.81.lnk'] });
    expect(list()).toEqual(['Tonic Life POS v2.1.0.lnk']);
  });

  it('una carpeta que no existe no rompe el arranque', () => {
    expect(repairShortcutsIn(path.join(dir, 'no-existe'), deps())).toEqual({
      rename: null,
      remove: [],
    });
  });
});
