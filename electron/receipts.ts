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
import { buildLogoBitmapBytes, loadLogoDataUrl } from './logo';
// Puro (sin Electron): el mismo bloque de totales que el carrito y el detalle.
import {
  buildReceiptTotalsRows,
  receiptTotalsLabel,
} from '../src/lib/receiptTotals';

// ============================================================================
// ESCRITOR DE TICKET: ESC/POS (Escpos) o HTML (HtmlReceipt, para PDF)
// ============================================================================

/**
 * Lo que usan los renderers de ticket/corte. `Escpos` lo cumple tal cual;
 * `HtmlReceipt` genera el mismo ticket como HTML para el modo "Impresora
 * normal / PDF" (CEDEAS sin térmica, 13-oct-2026): mismo contenido, mismas
 * líneas, solo cambia el transporte.
 */
export interface ReceiptWriter {
  init(): this;
  align(mode: 'left' | 'center' | 'right'): this;
  bold(on: boolean): this;
  size(width?: 1 | 2, height?: 1 | 2): this;
  line(s?: string): this;
  feed(lines?: number): this;
  cut(partial?: boolean): this;
  rawBuffer(buf: Buffer | Uint8Array): this;
}

interface HtmlLine {
  text?: string;
  logo?: string;
  align: 'left' | 'center' | 'right';
  bold: boolean;
  big: boolean;
}

export class HtmlReceipt implements ReceiptWriter {
  private lines: HtmlLine[] = [];
  private curAlign: 'left' | 'center' | 'right' = 'left';
  private curBold = false;
  private curBig = false;

  init(): this {
    return this;
  }
  align(mode: 'left' | 'center' | 'right'): this {
    this.curAlign = mode;
    return this;
  }
  bold(on: boolean): this {
    this.curBold = on;
    return this;
  }
  size(width: 1 | 2 = 1, height: 1 | 2 = 1): this {
    this.curBig = width === 2 || height === 2;
    return this;
  }
  line(s = ''): this {
    this.lines.push({
      text: s,
      align: this.curAlign,
      bold: this.curBold,
      big: this.curBig,
    });
    return this;
  }
  /** En PDF no hace falta "alimentar" papel: máximo 2 renglones en blanco. */
  feed(lines = 1): this {
    for (let i = 0; i < Math.min(2, lines); i++) this.line('');
    return this;
  }
  cut(): this {
    return this;
  }
  rawBuffer(): this {
    return this;
  }
  logo(dataUrl: string): this {
    this.lines.push({ logo: dataUrl, align: 'center', bold: false, big: false });
    return this;
  }

  /**
   * Documento para `printToPDF` en hoja carta: el ticket va centrado con el
   * ancho exacto de `cols` caracteres monoespaciados (misma alineación por
   * columnas que la térmica).
   */
  html(opts: { cols: number; title: string }): string {
    const body = this.lines
      .map((ln) => {
        if (ln.logo) {
          return `<div class="logo"><img src="${ln.logo}" alt="toniclife" /></div>`;
        }
        const cls = ['ln'];
        if (ln.align === 'center') cls.push('c');
        if (ln.align === 'right') cls.push('r');
        if (ln.bold) cls.push('b');
        if (ln.big) cls.push('big');
        const text = escapeHtml(sanitizeForPrinter(ln.text ?? '')) || ' ';
        return `<div class="${cls.join(' ')}">${text}</div>`;
      })
      .join('\n');
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(opts.title)}</title><style>
  @page { size: letter; margin: 12mm; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  .ticket {
    width: ${opts.cols}ch;
    margin: 0 auto;
    font-family: 'Consolas', 'Lucida Console', 'Courier New', monospace;
    font-size: 10pt;
    line-height: 1.3;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .ln { white-space: pre; min-height: 1.3em; }
  .c { text-align: center; }
  .r { text-align: right; }
  .b { font-weight: 700; }
  .big { font-size: 15pt; font-weight: 700; }
  .logo { text-align: center; margin: 2mm 0 3mm; }
  .logo img { height: 11mm; }
</style></head>
<body><div class="ticket">${body}</div></body></html>`;
  }
}

/**
 * Encabezado del ticket. Con `textLogo` (impresoras de MATRIZ DE PUNTO, que
 * no entienden el raster ESC/POS y lo imprimen como basura) el logo gráfico
 * se sustituye por "TONICLIFE" en texto doble alto/ancho.
 */
function printHeaderLogo(
  p: ReceiptWriter,
  paperWidth: 58 | 80,
  textLogo?: boolean,
): void {
  if (p instanceof HtmlReceipt) {
    // PDF: el logo va como imagen; sin asset cae al texto.
    const url = textLogo ? null : loadLogoDataUrl('logo-text-light-r.png');
    if (url) {
      p.logo(url);
    } else {
      p.align('center');
      p.size(2, 2).line('TONICLIFE').size(1, 1);
      p.line('');
    }
    return;
  }
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
  /** Etiqueta de la terminal que cobró (se imprime solo con varias terminales). */
  terminal?: string;
  /** Día local de la sucursal (YYYY-MM-DD), calculado en el renderer (el main
   *  no conoce la zona horaria de la sucursal). Con rango de varios días la
   *  lista se agrupa por día. */
  day?: string;
}

export interface CortePaymentRow {
  label: string;
  amount: number;
}

/** Ventas del día de una terminal (licencia POS). */
export interface CorteTerminalRow {
  label: string;
  salesCount: number;
  amount: number;
}

export interface CorteReceiptInput {
  branchName: string;
  date: string; // YYYY-MM-DD (día del corte o "Desde" del rango)
  /** "Hasta" del rango; ausente o igual a `date` = corte de un solo día. */
  dateTo?: string;
  /** Caja filtrada: se imprime "Caja: …"; ausente = todas las cajas. */
  terminalLabel?: string;
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

  /** Desglose por terminal: solo se imprime cuando hay más de una
   *  (sucursales con varias cajas separan su corte). */
  terminals?: CorteTerminalRow[];

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
  const p = new Escpos();
  renderCorte(p, input);
  return p.bytes();
}

/** Mismo corte como HTML (modo "Impresora normal / PDF"). */
export function buildCorteReceiptHtml(input: CorteReceiptInput): string {
  const p = new HtmlReceipt();
  renderCorte(p, input);
  return p.html({
    cols: colsFor(input.paperWidth),
    title: `Corte ${input.date}${input.dateTo && input.dateTo !== input.date ? ` al ${input.dateTo}` : ''}`,
  });
}

function renderCorte(p: ReceiptWriter, input: CorteReceiptInput): void {
  const cols = colsFor(input.paperWidth);
  const sep = '-'.repeat(cols);
  p.init();
  const fmt = (n: number) => formatMoney(n, input.currencySymbol);

  // Logo encabezado.
  printHeaderLogo(p, input.paperWidth, input.textLogo);

  // Titulo. Con rango de varios días el corte deja de ser "del día".
  const multiDay = !!input.dateTo && input.dateTo !== input.date;
  p.align('center');
  p.size(2, 2).line(multiDay ? 'CORTE DE VENTAS' : 'CORTE DEL DIA').size(1, 1);
  p.line(input.branchName);
  p.line(multiDay ? `Del ${input.date} al ${input.dateTo}` : input.date);
  if (input.terminalLabel) {
    p.line(`Caja: ${input.terminalLabel}`.slice(0, cols));
  }
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

  // --- POR TERMINAL (solo sucursales con varias cajas) ---
  const terminals = input.terminals ?? [];
  const multiTerminal = terminals.length > 1;
  if (multiTerminal) {
    p.bold(true).line('VENTAS POR TERMINAL').bold(false);
    for (const t of terminals) {
      p.line(
        labelValue(`${t.label} (${t.salesCount})`, fmt(t.amount), cols),
      );
    }
    p.line(sep);
  }

  // --- VENTAS (del día o del rango) ---
  p.bold(true)
    .line(
      multiDay
        ? `VENTAS (${input.sales.length})`
        : `VENTAS DEL DIA (${input.sales.length})`,
    )
    .bold(false);
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
    // Con varios días, un renglón de encabezado por día (en vez de una
    // columna más: las 3 columnas ya ocupan todo el ancho de 58 mm).
    let lastDay: string | undefined;
    for (const s of input.sales) {
      if (multiDay && s.day && s.day !== lastDay) {
        lastDay = s.day;
        p.bold(true).line(padRight(`-- ${s.day}`, cols)).bold(false);
      }
      // Con varias terminales, el folio lleva la terminal entre corchetes
      // para que el supervisor separe las ventas por caja.
      const folio =
        multiTerminal && s.terminal
          ? `${s.saleNumber} [${s.terminal}]`
          : s.saleNumber;
      p.line(
        itemLineFixed(
          folio,
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
}

// ============================================================================
// TICKET DE VENTA (ESC/POS)
// ============================================================================

export interface SaleReceiptItemRow {
  name: string;
  /** Clave del producto: se imprime entre paréntesis antes del nombre. */
  sku?: string;
  quantity: number;
  unitPrice: number;
  /** Lo que se imprime en el renglón: bruto CON impuesto (precio × cantidad
   *  − descuento manual de línea; en US × (1 + tasa)), ANTES del cupón. */
  total: number;
  /** Descuento MANUAL de línea en el espacio del precio (sin UI desde
   *  ago-2026); NUNCA la parte del cupón prorrateada. Para el Subtotal del
   *  bloque de totales con cupón. */
  lineDiscount?: number;
  /** true = el precio incluye el impuesto (MX); false = se añade (US). Decide
   *  la variante del bloque de totales con cupón (ver lib/receiptTotals.ts);
   *  sin dato se deduce por cuadre. */
  taxIncluded?: boolean;
  /** Tasa del renglón (decimal): solo los renglones CON impuesto opinan sobre
   *  `taxIncluded` (un producto MX sin regla fiscal llega como "no incluido"
   *  y mandaba el ticket a la variante US). */
  taxRate?: number;
  /** Contenido de un kit/paquete/promo: lo que la sucursal debe ENTREGAR.
   *  quantity ya viene multiplicada por la cantidad de kits vendidos. */
  components?: { name: string; quantity: number }[];
  /** Regalo a $0 de una campaña de membresía: se imprime "Regalo" en vez
   *  del precio unitario. */
  gift?: boolean;
}

export interface SaleReceiptPaymentRow {
  label: string;
  amount: number;
}

/** Bloque MEMBRESÍA del ticket (campaña "compra N puntos en producto y tu
 *  membresía es gratis"). Espejo en src/types.ts. */
export interface SaleReceiptMembership {
  name: string;
  code?: string;
  /** applied = posición otorgada; pending/failed = pendiente de aplicar;
   *  reverted = anulada (venta cancelada). */
  status: 'pending' | 'applied' | 'reverted' | 'failed';
  /** "Premium" / "Básico". */
  positionLabel: string;
  /** Regalos; delivered=false = sin existencia en la sucursal, no entregado. */
  gifts: { name: string; quantity: number; delivered: boolean }[];
  couponCode?: string | null;
  couponPercent?: number | null;
  /** YYYY-MM-DD */
  couponValidUntil?: string | null;
}

/** Bloque PROMOCIÓN del ticket (promo canjeada en la venta; 27-oct-2026).
 *  Espejo en src/types.ts. */
export interface SaleReceiptPromotion {
  code: string;
  name: string;
  minPointsRequired: number;
  /** Puntos del periodo con los que se ganó el derecho. */
  pointsAtGrant: number;
  /** true = alcanzada y canjeada en esta misma compra. */
  grantedBySale: boolean;
  items: { name: string; quantity: number }[];
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
  /** Base sin impuesto YA con el descuento prorrateado (regla 29-oct-2026). */
  subtotal: number;
  /** Descuento global (cupón o manual) CON impuesto: lo que ve el cliente. */
  discountAmount: number;
  /** Impuesto YA con el descuento prorrateado; subtotal + taxAmount = total. */
  taxAmount: number;
  total: number;
  /** Código del cupón aplicado: la fila del descuento dice "Cupón X". */
  couponCode?: string;

  payments: SaleReceiptPaymentRow[];
  amountReceived?: number;
  changeGiven: number;
  /** Moneda de la venta (MXN/USD…) — se imprime bajo el TOTAL. */
  currencyCode?: string;
  /** Puntos generados por ESTA venta (sin decimales en el ticket). */
  salePoints?: number;
  /** Saldo de puntos del periodo DESPUÉS de la venta ("Puntos totales"). */
  periodPoints?: number;
  /** Campaña de membresía aplicada a la venta: bloque MEMBRESÍA. */
  membership?: SaleReceiptMembership;
  /** Promociones canjeadas en la venta: bloque PROMOCIÓN (la línea a $0 ya
   *  va entre los artículos; aquí se explica el canje y qué incluye). */
  promotions?: SaleReceiptPromotion[];
  /** Venta guardada en la terminal sin conexión, aún no enviada al servidor:
   *  el folio es provisional y el ticket lo dice. */
  pendingSync?: boolean;
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

/**
 * Envuelve `text` por palabras en renglones de `width` columnas, máximo
 * `maxLines`; si aun así no cabe, el último renglón se corta. Una palabra más
 * larga que el ancho se parte.
 */
export function wrapWords(
  text: string,
  width: number,
  maxLines: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
    while (current.length > width) {
      lines.push(current.slice(0, width));
      current = current.slice(width);
    }
  }
  if (current.length > 0) lines.push(current);
  if (lines.length === 0) return [''];
  if (lines.length > maxLines) {
    // Se corta: el último renglón termina en "..." para que se note.
    const kept = lines.slice(0, maxLines);
    const last = kept[maxLines - 1];
    kept[maxLines - 1] =
      (last.length > width - 3 ? last.slice(0, width - 3) : last) + '...';
    return kept;
  }
  return lines;
}

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
  const p = new Escpos();
  renderSale(p, input);
  return p.bytes();
}

/** Mismo ticket de venta como HTML (modo "Impresora normal / PDF"). */
export function buildSaleReceiptHtml(input: SaleReceiptInput): string {
  const p = new HtmlReceipt();
  renderSale(p, input);
  return p.html({
    cols: colsFor(input.paperWidth),
    title: `Ticket ${input.saleNumber}`,
  });
}

function renderSale(p: ReceiptWriter, input: SaleReceiptInput): void {
  const cols = colsFor(input.paperWidth);
  const sep = '-'.repeat(cols);
  p.init();
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
  if (input.pendingSync) {
    // Cola local: la venta se registrará en el servidor en cuanto la
    // terminal recupere la conexión; el folio definitivo lo asigna el servidor.
    p.bold(true);
    p.line('VENTA POR SINCRONIZAR');
    p.bold(false);
    p.line('Folio provisional (sin conexion)');
  }
  p.line(sep);

  p.align('left');
  if (input.customerName) p.line(`Cliente: ${input.customerName}`.slice(0, cols));
  if (input.customerNumber)
    p.line(`No. dist: ${input.customerNumber}`.slice(0, cols));
  if (input.cashier) p.line(`Cajero:  ${input.cashier}`.slice(0, cols));
  if (input.customerName || input.customerNumber || input.cashier) p.line(sep);

  // --- ITEMS ---
  // Cada producto ocupa dos renglones: "(clave) nombre" completo (envuelto por
  // palabras, hasta 2 líneas) y debajo "cantidad x precio unitario ... total".
  // Antes iba todo en una línea y el nombre se cortaba a 27 caracteres en
  // 80 mm (11 en 58 mm) sin la clave; observación de sucursal del 12-oct-2026.
  for (const it of input.items) {
    const title = it.sku ? `(${it.sku}) ${it.name}` : it.name;
    for (const line of wrapWords(title, cols, 2)) p.line(line);
    // Regalo de campaña de membresía: a $0 y con la palabra "Regalo" en
    // lugar del precio unitario (la sucursal lo entrega sin cobrarlo).
    p.line(
      labelValue(
        it.gift
          ? `  ${it.quantity} x Regalo`
          : `  ${it.quantity} x ${fmt(it.unitPrice)}`,
        fmt(it.gift ? 0 : it.total),
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
  // Subtotal e IVA llegan YA con el descuento prorrateado y Descuento es el
  // monto CON impuesto (regla 29-oct-2026). Presentación (decisión de
  // Sistemas, 29-oct 11:40; lib/receiptTotals.ts, misma en carrito y detalle):
  //   - sin cupón/descuento: Subtotal, IVA, TOTAL, como siempre;
  //   - con cupón y precio con IVA incluido: Subtotal BRUTO (total + D),
  //     "Cupón X" −D, TOTAL y debajo "IVA incluido" con el impuesto neto
  //     (también en 0.00, como la reimpresión del admin);
  //   - con cupón e impuesto añadido (US): Subtotal sin impuesto, Descuento en
  //     el espacio del precio, Tax y TOTAL.
  // La fila IVA/Tax en 0 no se imprime (como siempre: antes era
  // `if (taxAmount > 0)`); las pantallas sí la muestran. "Cupón <código>"
  // solo si cabe junto al importe; si no, "Cupón" (labelValue recortaría el
  // importe con un código largo: coupons.code admite 40 caracteres).
  for (const row of buildReceiptTotalsRows({
    items: input.items,
    subtotal: input.subtotal,
    discountAmount: input.discountAmount,
    taxAmount: input.taxAmount,
    total: input.total,
    couponCode: input.couponCode,
  })) {
    if (row.kind === 'tax' && !(row.amount > 0)) continue;
    const value = fmt(row.amount);
    const text = labelValue(receiptTotalsLabel(row, value, cols), value, cols);
    if (row.kind === 'total') {
      p.bold(true).line(text).bold(false);
    } else {
      p.line(text);
    }
  }
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

  // --- MEMBRESÍA (campaña "compra N puntos y tu membresía es gratis") ---
  // Lo que el distribuidor se lleva además de la compra: la posición que se
  // le otorgó al cobrar, los regalos (y cuáles NO se entregaron por falta de
  // existencia) y el cupón de primera recompra con su vigencia.
  if (input.membership) renderMembership(p, input.membership, cols);

  // --- PROMOCIÓN (promo canjeada en esta venta; 27-oct-2026) ---
  // Igual que MEMBRESÍA: qué promo se llevó, si la alcanzó con esta misma
  // compra (canje en la misma compra) y qué incluye.
  if (input.promotions && input.promotions.length > 0) {
    renderPromotions(p, input.promotions, cols);
  }

  p.line(sep);
  p.align('center');
  p.line('¡Gracias por su compra!');
  p.line('toniclife.com');

  p.feed(6);
  p.cut(true);
}

/** "YYYY-MM-DD" → "DD/MM/YYYY"; cualquier otra cosa se imprime tal cual. */
function formatDmy(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function renderMembership(
  p: ReceiptWriter,
  m: SaleReceiptMembership,
  cols: number,
): void {
  const sep = '-'.repeat(cols);
  // Renglones envueltos por palabras con sangría fija (wrapWords colapsa
  // los espacios, por eso la sangría se antepone después de envolver).
  const indented = (text: string, indent: string, maxLines: number) =>
    wrapWords(text, Math.max(8, cols - indent.length), maxLines).map(
      (line) => indent + line,
    );

  p.line(sep);
  p.align('left');
  p.bold(true).line('MEMBRESÍA').bold(false);
  for (const line of wrapWords(`Campaña ${m.name}`, cols, 2)) p.line(line);
  if (m.status === 'reverted') {
    p.line('Anulada');
  } else if (m.status === 'applied') {
    p.line(`Posición: ${m.positionLabel}`.slice(0, cols));
  } else {
    p.line('Pendiente de aplicar');
  }
  if (m.gifts.length > 0) {
    p.line('Incluye:');
    for (const g of m.gifts) {
      const text = g.delivered
        ? `${g.quantity} x ${g.name}`
        : `${g.quantity} x ${g.name} (sin existencia, no entregado)`;
      for (const line of indented(text, '  ', 3)) p.line(line);
    }
  }
  if (m.couponCode) {
    const pct =
      m.couponPercent != null && Number.isFinite(Number(m.couponPercent))
        ? `${Number(m.couponPercent)} %`
        : '';
    let text = `Cupón ${m.couponCode}: ${pct ? `${pct} ` : ''}en tu primera recompra`;
    if (m.couponValidUntil) {
      text += `, válido hasta ${formatDmy(m.couponValidUntil)}`;
    }
    for (const line of wrapWords(text, cols, 3)) p.line(line);
  }
}

const fmtPts = (n: number) =>
  Math.round(n).toLocaleString('es-MX', { maximumFractionDigits: 0 });

function renderPromotions(
  p: ReceiptWriter,
  promos: readonly SaleReceiptPromotion[],
  cols: number,
): void {
  const sep = '-'.repeat(cols);
  const indented = (text: string, indent: string, maxLines: number) =>
    wrapWords(text, Math.max(8, cols - indent.length), maxLines).map(
      (line) => indent + line,
    );
  p.line(sep);
  p.align('left');
  p.bold(true).line(promos.length > 1 ? 'PROMOCIONES' : 'PROMOCIÓN').bold(false);
  promos.forEach((pr, i) => {
    if (i > 0) p.line('');
    for (const line of wrapWords(`${pr.code} - ${pr.name}`, cols, 2)) p.line(line);
    const detalle = pr.grantedBySale
      ? `Canjeada en esta misma compra: alcanzó los ${fmtPts(pr.minPointsRequired)} pts (${fmtPts(pr.pointsAtGrant)} acumulados)`
      : `Canjeada (derecho ganado con ${fmtPts(pr.minPointsRequired)} pts)`;
    for (const line of wrapWords(detalle, cols, 3)) p.line(line);
    if (pr.items.length > 0) {
      p.line('Incluye:');
      for (const it of pr.items) {
        for (const line of indented(`${it.quantity} x ${it.name}`, '  ', 2)) p.line(line);
      }
    }
  });
}

// ============================================================================
// LISTA DE ENTRADA DE TRASPASO (ESC/POS y PDF)
// ============================================================================
//
// Lo que la sucursal imprime al recibir mercancía (26-oct-2026, decisión de
// Dirección): cada renglón lleva una casilla "[ ]" para palomear con pluma al
// contar; ya recibido se reimprime con lo enviado/recibido y marca las
// diferencias. Mismo contenido en térmica y en PDF (histórico).

export interface TransferReceiptItemRow {
  sku?: string;
  name: string;
  /** Piezas enviadas. */
  quantity: number;
  /** Piezas recibidas (solo traspasos ya aplicados). */
  quantityReceived?: number;
}

export interface TransferReceiptInput {
  branchName: string;
  /** Nombre comercial para el encabezado (branch.ticketName). */
  ticketName?: string;
  movementNumber: string;
  originBranchName: string;
  destinationBranchName: string;
  /** 'in' = esta sucursal recibe; 'out' = esta sucursal envió. */
  direction: 'in' | 'out';
  /** 'pending' = por recibir (casillas en blanco); 'received' = ya aplicado. */
  status: 'pending' | 'received';
  /** ISO. */
  sentAt?: string;
  sentBy?: string;
  receivedAt?: string;
  receivedBy?: string;
  reason?: string;
  notes?: string;
  items: TransferReceiptItemRow[];
  paperWidth: 58 | 80;
  /** Matriz de punto: logo en texto, sin gráficos. */
  textLogo?: boolean;
}

export function buildTransferReceiptBytes(input: TransferReceiptInput): Buffer {
  const p = new Escpos();
  renderTransfer(p, input);
  return p.bytes();
}

/** Misma lista como HTML (modo "Impresora normal / PDF" e histórico). */
export function buildTransferReceiptHtml(input: TransferReceiptInput): string {
  const p = new HtmlReceipt();
  renderTransfer(p, input);
  return p.html({
    cols: colsFor(input.paperWidth),
    title: `Traspaso ${input.movementNumber}`,
  });
}

function formatDateTimeLocal(iso?: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('es-MX', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function renderTransfer(p: ReceiptWriter, input: TransferReceiptInput): void {
  const cols = colsFor(input.paperWidth);
  const sep = '-'.repeat(cols);
  p.init();

  printHeaderLogo(p, input.paperWidth, input.textLogo);

  p.align('center');
  if (input.ticketName) p.bold(true).line(input.ticketName.slice(0, cols)).bold(false);
  p.line(input.branchName.slice(0, cols));
  p.line(sep);
  p.size(2, 2)
    .line(input.direction === 'in' ? 'ENTRADA DE INVENTARIO' : 'TRASPASO ENVIADO')
    .size(1, 1);
  p.size(2, 2).line(input.movementNumber).size(1, 1);
  p.bold(true)
    .line(input.status === 'received' ? 'RECIBIDO' : 'POR RECIBIR')
    .bold(false);
  p.line(sep);

  p.align('left');
  for (const line of wrapWords(`De:   ${input.originBranchName}`, cols, 2)) p.line(line);
  for (const line of wrapWords(`Para: ${input.destinationBranchName}`, cols, 2)) p.line(line);
  if (input.sentAt || input.sentBy) {
    const who = input.sentBy ? ` - ${input.sentBy}` : '';
    for (const line of wrapWords(`Enviado: ${formatDateTimeLocal(input.sentAt)}${who}`, cols, 2)) p.line(line);
  }
  if (input.status === 'received' && (input.receivedAt || input.receivedBy)) {
    const who = input.receivedBy ? ` - ${input.receivedBy}` : '';
    for (const line of wrapWords(`Recibido: ${formatDateTimeLocal(input.receivedAt)}${who}`, cols, 2)) p.line(line);
  }
  if (input.reason) for (const line of wrapWords(`Motivo: ${input.reason}`, cols, 3)) p.line(line);
  if (input.notes) for (const line of wrapWords(`Notas: ${input.notes}`, cols, 3)) p.line(line);
  p.line(sep);

  // --- RENGLONES ---
  // "[ ] cant x (clave) producto"; la continuación del nombre va con sangría.
  // Ya recibido: "[x] rec/env" y "*" cuando hubo diferencia.
  const received = input.status === 'received';
  p.bold(true)
    .line(received ? '    Rec/Env  Producto' : '    Cant  Producto (palomear)')
    .bold(false);
  const indent = '    ';
  let totalQty = 0;
  let totalReceived = 0;
  let differences = 0;
  for (const it of input.items) {
    const title = it.sku ? `(${it.sku}) ${it.name}` : it.name;
    totalQty += it.quantity;
    let head: string;
    if (received) {
      const rec = it.quantityReceived ?? it.quantity;
      totalReceived += rec;
      const diff = rec !== it.quantity;
      if (diff) differences += 1;
      head = `[x] ${String(rec)}/${String(it.quantity)}${diff ? '*' : ''} `;
    } else {
      head = `[ ] ${padLeft(String(it.quantity), 3)} x `;
    }
    const width = Math.max(8, cols - head.length);
    const lines = wrapWords(title, width, 3);
    p.line((head + lines[0]).slice(0, cols));
    for (const extra of lines.slice(1)) p.line((indent + extra).slice(0, cols));
  }
  p.line(sep);
  p.line(labelValue('Productos', String(input.items.length), cols));
  p.line(labelValue('Piezas enviadas', String(totalQty), cols));
  if (received) {
    p.line(labelValue('Piezas recibidas', String(totalReceived), cols));
    if (differences > 0) {
      p.bold(true)
        .line(labelValue('Renglones con diferencia (*)', String(differences), cols))
        .bold(false);
    }
  }
  p.line(sep);

  // --- FIRMAS ---
  p.line('');
  if (!received) {
    p.line('Piezas contadas: ' + '_'.repeat(Math.min(14, cols - 18)));
    p.line('');
  }
  p.line('Recibio: ' + '_'.repeat(Math.min(22, cols - 9)));
  p.line('');
  p.line('Firma:   ' + '_'.repeat(Math.min(22, cols - 9)));
  p.line('');
  p.line('Observaciones:');
  p.line('_'.repeat(cols));
  p.line('_'.repeat(cols));
  p.feed(1);
  p.align('center');
  p.line(`Impreso ${formatDateTimeLocal(new Date().toISOString())}`);

  p.feed(6);
  p.cut(true);
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
