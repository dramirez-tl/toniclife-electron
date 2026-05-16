// escpos.ts - Builder de bytes ESC/POS para impresoras termicas.
//
// Estandar EPSON (compatible con TM-T20III y la mayoria de termicas POS-80C
// genericas). Texto codificado a PC858 (Latin-1 multilingual + euro) que
// cubre acentos espanoles y la enie. Se selecciona con ESC t 19.

import iconv from 'iconv-lite';

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** Columnas estandar para Font A:  58mm -> 32, 80mm -> 48. */
export function colsFor(paperWidth: 58 | 80): number {
  return paperWidth === 80 ? 48 : 32;
}

function bytes(...b: number[]): Uint8Array {
  return new Uint8Array(b);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((a, p) => a + p.byteLength, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

// ============================================================================
// BUILDER
// ============================================================================

export class Escpos {
  private parts: Uint8Array[] = [];

  init(): this {
    this.parts.push(bytes(ESC, 0x40)); // ESC @  reset
    this.parts.push(bytes(ESC, 0x74, 19)); // ESC t 19  codepage PC858
    return this;
  }

  align(mode: 'left' | 'center' | 'right'): this {
    const n = mode === 'left' ? 0 : mode === 'center' ? 1 : 2;
    this.parts.push(bytes(ESC, 0x61, n));
    return this;
  }

  bold(on: boolean): this {
    this.parts.push(bytes(ESC, 0x45, on ? 1 : 0));
    return this;
  }

  /** GS ! n  ancho y alto de caracteres (nibble alto=ancho, bajo=alto). */
  size(width: 1 | 2 = 1, height: 1 | 2 = 1): this {
    const n = ((width - 1) << 4) | (height - 1);
    this.parts.push(bytes(GS, 0x21, n));
    return this;
  }

  text(s: string): this {
    this.parts.push(
      new Uint8Array(iconv.encode(sanitizeForPrinter(s), 'cp858')),
    );
    return this;
  }

  line(s = ''): this {
    return this.text(s).raw(LF);
  }

  /** ESC d n  avanza n lineas. */
  feed(lines = 1): this {
    this.parts.push(bytes(ESC, 0x64, Math.max(0, Math.min(255, lines))));
    return this;
  }

  separator(cols: number, char = '-'): this {
    return this.line(char.repeat(cols));
  }

  /** GS V m  corte. partial=true -> corte parcial, false -> total. */
  cut(partial = false): this {
    this.parts.push(bytes(GS, 0x56, partial ? 0x01 : 0x00));
    return this;
  }

  /** ESC p m t1 t2  pulso al cajon. pin: 0=pin2, 1=pin5. */
  drawerPulse(pin: 0 | 1 = 0, onMs = 50, offMs = 250): this {
    const t1 = Math.max(1, Math.min(255, Math.round(onMs / 2)));
    const t2 = Math.max(1, Math.min(255, Math.round(offMs / 2)));
    this.parts.push(bytes(ESC, 0x70, pin, t1, t2));
    return this;
  }

  raw(...b: number[]): this {
    this.parts.push(bytes(...b));
    return this;
  }

  /** Inserta un buffer ya formado (ej. comando GS v 0 con bitmap del logo). */
  rawBuffer(buf: Buffer | Uint8Array): this {
    this.parts.push(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
    return this;
  }

  bytes(): Buffer {
    return Buffer.from(concat(this.parts));
  }
}

// ============================================================================
// SANITIZADOR Unicode -> cp858
// ============================================================================

/**
 * cp858 no cubre punctuacion tipografica moderna. Traducimos lo mas comun
 * a ASCII para evitar que aparezcan como '?' en el ticket.
 */
export function sanitizeForPrinter(s: string): string {
  return s
    .replace(/[–—]/g, '-') // en-dash, em-dash -> -
    .replace(/[‘’]/g, "'") // smart quotes -> '
    .replace(/[“”]/g, '"') // smart double quotes -> "
    .replace(/…/g, '...') // ellipsis -> ...
    .replace(/ /g, ' '); // nbsp -> espacio normal
}

// ============================================================================
// UTILIDADES DE LAYOUT (texto plano alineado a columnas)
// ============================================================================

export function padRight(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + ' '.repeat(n - s.length);
}

export function padLeft(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return ' '.repeat(n - s.length) + s;
}

export function center(s: string, cols: number): string {
  if (s.length >= cols) return s.slice(0, cols);
  const pad = Math.floor((cols - s.length) / 2);
  return ' '.repeat(pad) + s;
}

/**
 * Linea de 2 columnas: etiqueta a la izquierda, valor a la derecha,
 * separados con espacios para ocupar `cols` chars exactos.
 */
export function labelValue(label: string, value: string, cols: number): string {
  const space = cols - label.length - value.length;
  if (space < 1) return (label + ' ' + value).slice(0, cols);
  return label + ' '.repeat(space) + value;
}

/**
 * Linea de item de venta: nombre, cantidad, precio, total.
 * Tamanos fijos por columna; el nombre absorbe el resto del ancho.
 */
export function itemLine(
  name: string,
  qty: string,
  price: string,
  total: string,
  cols: number,
): string {
  const W_QTY = 5;
  const W_PRICE = 8;
  const W_TOTAL = 8;
  const W_NAME = cols - W_QTY - W_PRICE - W_TOTAL;
  return (
    padRight(name, W_NAME) +
    padLeft(qty, W_QTY) +
    padLeft(price, W_PRICE) +
    padLeft(total, W_TOTAL)
  );
}
