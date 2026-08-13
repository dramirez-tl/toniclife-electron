// receipts.ts - Renderer de tickets para impresion termica.
//
// Cada ticket se construye una sola vez como "lineas de texto" alineadas a
// columnas, y luego se renderiza para los dos transportes:
//   - Network: bytes ESC/POS via Escpos builder (codepage cp858).
//   - System:  HTML <pre> monoespaciado con la misma layout exacta.
// Esto garantiza que la prueba se vea identica en ambos modos.

import {
  Escpos,
  colsFor,
  labelValue,
  itemLine,
  padLeft,
  padRight,
  center,
  sanitizeForPrinter,
} from './escpos';
import { buildLogoBitmapBytes } from './logo';

/**
 * Encabezado del ticket. Con `textLogo` (impresoras de MATRIZ DE PUNTO, que
 * no entienden el raster ESC/POS y lo imprimen como basura) el logo gráfico
 * se sustituye por "TONICLIFE" en texto doble alto/ancho.
 */
function printHeaderLogo(
  p: Escpos,
  paperWidth: 58 | 80,
  textLogo?: boolean,
): void {
  if (textLogo) {
    p.align('center');
    p.size(2, 2).line('TONICLIFE').size(1, 1);
    p.line('');
    return;
  }
  // Logo de texto "toniclife" centrado. Proporcion ~5:1 (ancho:alto):
  // 80mm cabe ~400 dots (~70% del cabezal 576); 58mm ~300 dots.
  const logoWidth = paperWidth === 80 ? 400 : 300;
  const logoBytes = buildLogoBitmapBytes(logoWidth, 'logo-text-light-r.png');
  if (logoBytes) {
    p.align('center');
    p.rawBuffer(logoBytes);
    p.line('');
  }
}

export interface TestReceiptInput {
  branchName: string;
  printerLabel: string; // "192.168.1.50:9100" o "POS-80C"
  paperWidth: 58 | 80;
  /** Matriz de punto: logo en texto, sin gráficos. */
  textLogo?: boolean;
}

export interface CorteSaleRow {
  saleNumber: string;
  /** ISO string o cualquier cosa que Date parse. */
  createdAt: string;
  customerName?: string;
  total: number;
}

export interface CortePaymentRow {
  label: string;
  amount: number;
}

export interface CorteReceiptInput {
  branchName: string;
  date: string; // YYYY-MM-DD
  paperWidth: 58 | 80;
  /** Matriz de punto: logo en texto, sin gráficos. */
  textLogo?: boolean;
  currencySymbol: string;
  cashier?: string;

  // Resumen
  totalSales: number;
  totalAmount: number;
  averageTicket: number;
  itemsSold: number;
  totalRefunds: number;
  refundsCount: number;

  // Desglose
  payments: CortePaymentRow[];

  // Lista de ventas
  sales: CorteSaleRow[];
}

// ============================================================================
// LAYOUT COMUN (lineas de texto alineadas a columnas)
// ============================================================================

interface Line {
  /** Texto ya alineado a `cols` chars. */
  text: string;
  /** Estilo opcional para renderizar (bold, doble alto, etc.). */
  style?: 'bold' | 'double' | 'normal';
  /** Alineacion para HTML (en ESC/POS ya se aplica el align cmd). */
  align?: 'left' | 'center' | 'right';
}

function buildTestLines(input: TestReceiptInput): Line[] {
  const cols = colsFor(input.paperWidth);
  const sep = '-'.repeat(cols);
  const now = new Date();
  const fecha = now.toLocaleString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return [
    { text: 'Tonic Life POS', style: 'double', align: 'center' },
    { text: 'Prueba de impresión', align: 'center' },
    { text: sep },
    { text: padRight('Sucursal: ' + input.branchName, cols).slice(0, cols) },
    { text: 'Fecha: ' + fecha },
    {
      text: padRight('Impresora: ' + input.printerLabel, cols).slice(0, cols),
    },
    { text: `Ancho: ${input.paperWidth}mm (${cols} cols)` },
    { text: sep },
    { text: center('IMPRESIÓN OK', cols), style: 'bold', align: 'center' },
    { text: '' },
    { text: 'Texto normal' },
    { text: 'Texto en negrita', style: 'bold' },
    { text: 'Doble alto', style: 'double' },
    { text: 'Acentos: áéíóú ñÑ ¿? ¡!' },
    { text: sep },
    { text: itemLine('Producto demo', '1', '10.00', '10.00', cols) },
    { text: itemLine('Otro producto', '2', '61.73', '123.45', cols) },
    { text: itemLine('IVA 16%', '', '', '21.35', cols) },
    { text: padRight('', cols - 8) + '--------' },
    { text: labelValue('TOTAL', '$154.80', cols), style: 'bold' },
    { text: sep },
    { text: 'Si lees este ticket,', align: 'center' },
    { text: 'la impresora está lista.', align: 'center' },
  ];
}

// ============================================================================
// RENDER A ESC/POS (network)
// ============================================================================

export function buildTestReceiptBytes(input: TestReceiptInput): Buffer {
  const lines = buildTestLines(input);
  const p = new Escpos().init();

  printHeaderLogo(p, input.paperWidth, input.textLogo);

  for (const ln of lines) {
    p.align(ln.align ?? 'left');
    if (ln.style === 'double') {
      p.size(2, 2).line(ln.text.trim()).size(1, 1);
      continue;
    }
    if (ln.style === 'bold') {
      p.bold(true).line(ln.text).bold(false);
      continue;
    }
    p.line(ln.text);
  }

  // El cortador esta fisicamente ~10-12mm despues del cabezal de impresion.
  // Si cortamos inmediatamente despues del ultimo texto, la cuchilla pasa
  // por encima de la ultima linea. 6 lineas de feed = ~18-24mm de margen.
  p.feed(6);
  p.cut(true);
  return p.bytes();
}

// ============================================================================
// RENDER A HTML (system)
// ============================================================================

/**
 * Renderiza el mismo layout pero como HTML <pre> monoespaciado. Esto evita
 * los problemas de wrapping del navegador con CSS flex y garantiza que
 * cada caracter ocupa exactamente una columna, igual que en ESC/POS.
 *
 * font-size escalado al ancho del papel para que las 32/48 columnas quepan
 * exactamente en 58mm/80mm fisicos (sin overflow ni recortes a la derecha).
 */
export function buildTestReceiptHtml(input: TestReceiptInput): string {
  const lines = buildTestLines(input);

  // Calibracion empirica para drivers Windows tipo POS-80C generico:
  //   - Area imprimible 80mm ~ 72mm (no los 80mm fisicos).
  //   - Consolas 10pt mide ~1.94mm/char -> 48 chars = 93mm = se corta.
  //   - Bajamos a 7pt para que 48 chars ocupen ~65mm y caben con margen.
  // En 58mm el calculo similar nos da 7pt para 32 chars ~ 44mm.
  const fontPt = 7;
  // Padding lateral minimo. El driver Windows ya aplica su propio margen
  // mecanico; si agregamos mas, el lado izquierdo queda muy retirado.
  const sideMm = 2;

  // Construimos UN solo bloque <pre> con todo el contenido. Inline tags
  // <b> y <span> aplican estilos sin romper la alineacion por columnas.
  const body = lines
    .map((ln) => {
      const text = escapeHtml(sanitizeForPrinter(ln.text)) || ' ';
      if (ln.style === 'double') {
        return `<span class="big">${text}</span>`;
      }
      if (ln.style === 'bold') {
        return `<b>${text}</b>`;
      }
      return text;
    })
    .join('\n');

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { margin: 0; size: ${input.paperWidth}mm auto; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    color: #000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    /* Forzar inicio en la esquina superior izquierda absoluta. Algunos
       drivers Windows agregan margen propio si detectan padding/margin
       sin valor explicito. */
    margin-top: 0 !important;
    padding-top: 0 !important;
  }
  pre {
    margin: 0;
    padding: 0 ${sideMm}mm 0 ${sideMm}mm;
    font-family: 'Consolas', 'Lucida Console', 'Courier New', monospace;
    font-size: ${fontPt}pt;
    line-height: 1.2;
    white-space: pre;
    color: #000;
    font-weight: 600;
  }
  .big {
    font-size: ${fontPt * 1.5}pt;
    font-weight: 800;
  }
  b { font-weight: 900; }
</style></head>
<body><pre>${body}</pre></body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ============================================================================
// CORTE DEL DIA (ESC/POS)
// ============================================================================

function formatTime12h(iso: string): string {
  try {
    const d = new Date(iso);
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'p.m.' : 'a.m.';
    h = h % 12 || 12;
    return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
  } catch {
    return '';
  }
}

function formatMoney(n: number, sym: string): string {
  const v = Math.abs(Number(n) || 0).toFixed(2);
  return n < 0 ? `-${sym}${v}` : `${sym}${v}`;
}

export function buildCorteReceiptBytes(input: CorteReceiptInput): Buffer {
  const cols = colsFor(input.paperWidth);
  const sep = '-'.repeat(cols);
  const p = new Escpos().init();
  const fmt = (n: number) => formatMoney(n, input.currencySymbol);

  // Logo encabezado.
  printHeaderLogo(p, input.paperWidth, input.textLogo);

  // Titulo.
  p.align('center');
  p.size(2, 2).line('CORTE DEL DIA').size(1, 1);
  p.line(input.branchName);
  p.line(input.date);
  p.line(sep);

  // --- RESUMEN ---
  p.align('left');
  p.bold(true).line('RESUMEN').bold(false);
  p.line(labelValue('Ventas', String(input.totalSales), cols));
  p.line(labelValue('Monto total', fmt(input.totalAmount), cols));
  p.line(labelValue('Ticket promedio', fmt(input.averageTicket), cols));
  p.line(labelValue('Items vendidos', String(input.itemsSold), cols));
  p.line(sep);

  // --- DESGLOSE POR METODO DE PAGO ---
  p.bold(true).line('DESGLOSE POR METODO DE PAGO').bold(false);
  if (input.payments.length === 0) {
    p.line('(sin pagos registrados)');
  } else {
    for (const row of input.payments) {
      p.line(labelValue(row.label, fmt(row.amount), cols));
    }
  }
  if (input.refundsCount > 0 && input.totalRefunds !== 0) {
    p.line(
      labelValue(
        `Reembolsos (${input.refundsCount})`,
        fmt(-Math.abs(input.totalRefunds)),
        cols,
      ),
    );
  }
  p.line(sep);

  // --- VENTAS DEL DIA ---
  p.bold(true).line(`VENTAS DEL DIA (${input.sales.length})`).bold(false);
  if (input.sales.length === 0) {
    p.line('(sin ventas)');
  } else {
    // Cabecera de tabla. Layout 80mm (48 cols):
    //   folio(28) hora(10) total(10)
    // Layout 58mm (32 cols):
    //   folio(18) hora(7)  total(7)
    const wHora = input.paperWidth === 80 ? 10 : 7;
    const wTotal = input.paperWidth === 80 ? 10 : 7;
    const wFolio = cols - wHora - wTotal;

    p.line(
      padRight('Folio', wFolio) +
        padRight('Hora', wHora) +
        padRight('Total', wTotal),
    );
    for (const s of input.sales) {
      p.line(
        itemLineFixed(
          s.saleNumber,
          formatTime12h(s.createdAt),
          fmt(Number(s.total)),
          wFolio,
          wHora,
          wTotal,
        ),
      );
    }
  }
  p.line(sep);

  // --- FIRMA / PIE ---
  p.line('');
  p.line(`Cajero: ${input.cashier ?? ''}`);
  p.line('Firma:  ' + '_'.repeat(Math.min(24, cols - 9)));
  p.feed(2);
  p.align('center').bold(true).line('FIN DEL CORTE').bold(false);

  p.feed(6);
  p.cut(true);
  return p.bytes();
}

// ============================================================================
// TICKET DE VENTA (ESC/POS)
// ============================================================================

export interface SaleReceiptItemRow {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  /** Contenido de un kit/paquete/promo: lo que la sucursal debe ENTREGAR.
   *  quantity ya viene multiplicada por la cantidad de kits vendidos. */
  components?: { name: string; quantity: number }[];
}

export interface SaleReceiptPaymentRow {
  label: string;
  amount: number;
}

export interface SaleReceiptInput {
  branchName: string;
  /** Nombre comercial para el encabezado del ticket (branch.ticketName). */
  ticketName?: string;
  saleNumber: string;
  /** ISO string de la venta. */
  createdAt: string;
  cashier?: string;
  customerName?: string;
  /** Número de distribuidor/cliente — SIEMPRE imprimirlo cuando exista:
   *  hay homónimos en la red y el número es la única forma de cotejar a
   *  quién se abonaron los puntos. */
  customerNumber?: string;
  paperWidth: 58 | 80;
  /** Matriz de punto: logo en texto, sin gráficos. */
  textLogo?: boolean;
  currencySymbol: string;

  items: SaleReceiptItemRow[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;

  payments: SaleReceiptPaymentRow[];
  amountReceived?: number;
  changeGiven: number;
  /** Moneda de la venta (MXN/USD…) — se imprime bajo el TOTAL. */
  currencyCode?: string;
  /** Puntos generados por ESTA venta (sin decimales en el ticket). */
  salePoints?: number;
  /** Saldo de puntos del periodo DESPUÉS de la venta ("Puntos totales"). */
  periodPoints?: number;
}

// Datos fiscales del emisor — mismos en todos los tickets (paridad con el
// ticket del sistema legacy).
const COMPANY_LEGAL_NAME = 'TONIC WORLD CENTER S.A. DE C.V.';
const COMPANY_RFC = 'TWC-140715-8R6';
const COMPANY_FISCAL_ADDRESS = [
  '05 DE FEBRERO No. 426',
  'COL. CENTRO, CP 37000',
  'LEÓN, GTO.',
];

/** Nombre legible de la moneda para el pie del total. */
function currencyDisplayName(code?: string): string | null {
  if (!code) return null;
  switch (code.toUpperCase()) {
    case 'MXN':
      return 'Pesos Mexicanos';
    case 'USD':
      return 'Dolares Americanos';
    default:
      return code.toUpperCase();
  }
}

export function buildSaleReceiptBytes(input: SaleReceiptInput): Buffer {
  const cols = colsFor(input.paperWidth);
  const sep = '-'.repeat(cols);
  const p = new Escpos().init();
  const fmt = (n: number) => formatMoney(n, input.currencySymbol);
  const fecha = new Date(input.createdAt).toLocaleString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  // Logo encabezado (mismo asset que test/corte).
  printHeaderLogo(p, input.paperWidth, input.textLogo);

  p.align('center');
  // Datos fiscales del emisor (debajo del logo, antes de la sucursal).
  p.bold(true).line(COMPANY_LEGAL_NAME.slice(0, cols)).bold(false);
  p.line(COMPANY_RFC);
  for (const line of COMPANY_FISCAL_ADDRESS) p.line(line.slice(0, cols));
  p.line('');
  if (input.ticketName) p.bold(true).line(input.ticketName).bold(false);
  p.line(input.branchName);
  p.line(sep);
  p.size(2, 2).line(input.saleNumber).size(1, 1);
  p.line(fecha);
  p.line(sep);

  p.align('left');
  if (input.customerName) p.line(`Cliente: ${input.customerName}`.slice(0, cols));
  if (input.customerNumber)
    p.line(`No. dist: ${input.customerNumber}`.slice(0, cols));
  if (input.cashier) p.line(`Cajero:  ${input.cashier}`.slice(0, cols));
  if (input.customerName || input.customerNumber || input.cashier) p.line(sep);

  // --- ITEMS ---
  for (const it of input.items) {
    p.line(
      itemLine(
        it.name,
        String(it.quantity),
        fmt(it.unitPrice),
        fmt(it.total),
        cols,
      ),
    );
    // Contenido del kit/paquete/promo (paridad con el ticket del legacy):
    // la sucursal arma el kit con esta lista al entregarlo.
    if (it.components && it.components.length > 0) {
      p.line('  Incluye:'.slice(0, cols));
      for (const c of it.components) {
        p.line(`   ${c.quantity} x ${c.name}`.slice(0, cols));
      }
    }
  }
  p.line(sep);

  // --- TOTALES ---
  p.line(labelValue('Subtotal', fmt(input.subtotal), cols));
  if (input.discountAmount > 0) {
    p.line(labelValue('Descuento', fmt(-input.discountAmount), cols));
  }
  if (input.taxAmount > 0) {
    p.line(labelValue('IVA', fmt(input.taxAmount), cols));
  }
  p.bold(true).line(labelValue('TOTAL', fmt(input.total), cols)).bold(false);
  {
    const moneda = currencyDisplayName(input.currencyCode);
    if (moneda) p.line(labelValue('Moneda', moneda, cols));
  }
  p.line(sep);

  // --- PAGOS ---
  for (const pay of input.payments) {
    p.line(labelValue(pay.label, fmt(pay.amount), cols));
  }
  if (input.amountReceived !== undefined && input.amountReceived > 0) {
    p.line(labelValue('Recibido', fmt(input.amountReceived), cols));
  }
  if (input.changeGiven > 0) {
    p.bold(true)
      .line(labelValue('CAMBIO', fmt(input.changeGiven), cols))
      .bold(false);
  }

  // Puntos SIN decimales: los de ESTA compra y el saldo total del periodo
  // con esta compra incluida (paridad con el ticket del legacy).
  {
    const salePts =
      input.salePoints != null ? Math.round(input.salePoints) : 0;
    const totalPts =
      input.periodPoints != null ? Math.round(input.periodPoints) : 0;
    if (salePts > 0 || totalPts > 0) {
      p.line(sep);
      if (salePts > 0) {
        p.line(labelValue('Puntos de la compra', String(salePts), cols));
      }
      if (totalPts > 0) {
        p.line(labelValue('Puntos totales', String(totalPts), cols));
      }
    }
  }

  p.line(sep);
  p.align('center');
  p.line('¡Gracias por su compra!');
  p.line('toniclife.com');

  p.feed(6);
  p.cut(true);
  return p.bytes();
}

/** 3-col row con anchos fijos: folio / hora / total (total right-aligned). */
function itemLineFixed(
  folio: string,
  hora: string,
  total: string,
  wFolio: number,
  wHora: number,
  wTotal: number,
): string {
  return (
    padRight(folio.slice(0, wFolio - 1), wFolio) +
    padRight(hora.slice(0, wHora - 1), wHora) +
    padLeft(total, wTotal)
  );
}
