// quoteHtml.ts - La hoja de la COTIZACIÓN (10-nov-2026): tipos del contenido,
// fecha, nombre de archivo y el HTML autocontenido. Lo usa el proceso
// principal (electron/quote.ts) para pintarla como imagen o PDF, así que NO
// importa nada del renderer (ni la API ni los stores): los datos ya llegan
// armados por lib/quote.ts. Puro.

import type { ReceiptTotalsRow } from './receiptTotals';

export interface QuoteItem {
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  /** Renglones chicos bajo el nombre: contenido del kit, promoción, evento. */
  notes: string[];
}

export interface QuoteGift {
  sku: string;
  name: string;
  quantity: number;
  /** Promoción que lo regala. */
  promoName: string;
}

/** Lo que viaja al proceso principal (serializable). */
export interface QuotePayload {
  /** ISO del momento en que se generó. */
  createdAt: string;
  /** Zona horaria de la sucursal (IANA) para imprimir la fecha. */
  timezone?: string;
  branchName: string;
  /** Quien atiende en modo staff; en terminal de sucursal va vacío. */
  attendedBy?: string;
  customerName?: string;
  customerNumber?: string;
  currencySymbol: string;
  currencyCode: string;
  items: QuoteItem[];
  gifts: QuoteGift[];
  totals: ReceiptTotalsRow[];
  /** Ahorro por promociones de temporada (informativo). */
  seasonalDiscount: number;
  /** Puntos de la compra (solo con distribuidor asignado). */
  totalPoints: number;
  couponDescription?: string;
}

const money = (n: number, symbol: string) =>
  `${symbol}${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * "10 de noviembre de 2026, 13:45" en la zona de la sucursal. Se arma con las
 * partes de Intl (no con su texto completo): el formato entero cambia según la
 * versión de ICU ("…, 13:45" en Chromium; "… a las 13:45" en Node).
 */
export function quoteDateLabel(iso: string, timezone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const opts: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  };
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('es-MX', { ...opts, timeZone: timezone || undefined }).formatToParts(d);
  } catch {
    // Zona inválida en la sucursal: la del equipo.
    parts = new Intl.DateTimeFormat('es-MX', opts).formatToParts(d);
  }
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')} de ${get('month')} de ${get('year')}, ${get('hour')}:${get('minute')}`;
}

/** Nombre base de los archivos: cotizacion-<distribuidor|publico>-AAAAMMDD-HHMM. */
export function quoteFileBase(payload: QuotePayload): string {
  const d = new Date(payload.createdAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = Number.isNaN(d.getTime())
    ? 'sin-fecha'
    : `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const who = (payload.customerNumber || 'publico').replace(/[^A-Za-z0-9]+/g, '');
  return `cotizacion-${who || 'publico'}-${stamp}`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Ancho de la hoja en px: cabe en el cuerpo de un correo sin reducirse. */
export const QUOTE_WIDTH_PX = 820;

export const QUOTE_LEGEND =
  'Cotización informativa. Los precios, las promociones y las existencias son los vigentes al momento de generarla y pueden cambiar. No aparta producto.';

/**
 * La hoja de la cotización en HTML autocontenido (sin scripts ni recursos
 * externos; el logo llega como data URL). Mismo HTML para la imagen y el PDF.
 */
export function buildQuoteHtml(
  payload: QuotePayload,
  opts: { logoDataUrl?: string | null } = {},
): string {
  const fmt = (n: number) => money(n, payload.currencySymbol);
  const pieces = payload.items.reduce((acc, it) => acc + it.quantity, 0);

  const rows = payload.items
    .map(
      (it, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td class="sku">${esc(it.sku)}</td>
        <td class="name">${esc(it.name)}${it.notes
          .map((n) => `<div class="note">${esc(n)}</div>`)
          .join('')}</td>
        <td class="qty">${it.quantity}</td>
        <td class="money">${fmt(it.unitPrice)}</td>
        <td class="money strong">${fmt(it.total)}</td>
      </tr>`,
    )
    .join('');

  const gifts =
    payload.gifts.length === 0
      ? ''
      : payload.gifts
          .map(
            (g) => `
      <tr class="gift">
        <td class="num">+</td>
        <td class="sku">${esc(g.sku)}</td>
        <td class="name">${esc(g.name)}<div class="note">Regalo: ${esc(g.promoName)}</div></td>
        <td class="qty">${g.quantity}</td>
        <td class="money">${fmt(0)}</td>
        <td class="money strong">${fmt(0)}</td>
      </tr>`,
          )
          .join('');

  const totals = payload.totals
    .map((row) => {
      switch (row.kind) {
        case 'discount':
          return `<tr class="discount"><td>${row.code ? `Cupón ${esc(row.code)}` : esc(row.label)}</td><td>- ${fmt(-row.amount)}</td></tr>`;
        case 'total':
          return `<tr class="total"><td>Total</td><td>${fmt(row.amount)} <span class="cur">${esc(payload.currencyCode)}</span></td></tr>`;
        case 'taxIncluded':
          return `<tr class="minor"><td>IVA incluido</td><td>${fmt(row.amount)}</td></tr>`;
        case 'tax':
          return `<tr><td>Impuestos</td><td>${fmt(row.amount)}</td></tr>`;
        default:
          return `<tr><td>Subtotal</td><td>${fmt(row.amount)}</td></tr>`;
      }
    })
    .join('');

  const extras = [
    payload.seasonalDiscount > 0
      ? `<tr class="minor save"><td>Ahorro por promociones</td><td>${fmt(payload.seasonalDiscount)}</td></tr>`
      : '',
    payload.totalPoints > 0
      ? `<tr class="minor"><td>Puntos de la compra</td><td>${payload.totalPoints.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pts</td></tr>`
      : '',
  ].join('');

  const customer = payload.customerName
    ? `${esc(payload.customerName)}${payload.customerNumber ? ` <span class="muted">· No. ${esc(payload.customerNumber)}</span>` : ''}`
    : 'Precio público <span class="muted">· sin distribuidor asignado</span>';

  const info = [
    `<div><span class="label">Para</span><span class="value">${customer}</span></div>`,
    `<div><span class="label">Sucursal</span><span class="value">${esc(payload.branchName)}</span></div>`,
    payload.attendedBy
      ? `<div><span class="label">Atendió</span><span class="value">${esc(payload.attendedBy)}</span></div>`
      : '',
    payload.couponDescription
      ? `<div><span class="label">Cupón</span><span class="value">${esc(payload.couponDescription)}</span></div>`
      : '',
  ].join('');

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Cotización</title><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #ffffff; }
  body { width: ${QUOTE_WIDTH_PX}px; font-family: 'Segoe UI', Arial, Helvetica, sans-serif; color: #1f2937; font-size: 13px; line-height: 1.35; }
  .sheet { padding: 28px 32px 24px; }
  .head { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #3E667D; padding-bottom: 14px; }
  .head img { height: 36px; width: auto; display: block; }
  .brand { font-size: 22px; font-weight: 700; color: #3E667D; letter-spacing: .5px; }
  .title { text-align: right; }
  .title h1 { margin: 0; font-size: 22px; letter-spacing: 2px; color: #3E667D; }
  .title p { margin: 2px 0 0; font-size: 12px; color: #6b7280; }
  .info { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin: 16px 0 14px; }
  .info .label { display: inline-block; min-width: 62px; font-size: 11px; text-transform: uppercase; letter-spacing: .6px; color: #6b7280; }
  .info .value { font-weight: 600; }
  .muted { color: #6b7280; font-weight: 400; }
  table.items { width: 100%; border-collapse: collapse; }
  table.items th { background: #3E667D; color: #ffffff; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; padding: 7px 8px; text-align: left; }
  table.items th.r, table.items td.money { text-align: right; white-space: nowrap; }
  table.items th.c, table.items td.qty, table.items td.num { text-align: center; }
  table.items td { padding: 7px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  table.items tr:nth-child(even) td { background: #f8fafc; }
  table.items td.num { color: #9ca3af; width: 30px; }
  table.items td.sku { font-family: Consolas, 'Courier New', monospace; font-size: 12px; white-space: nowrap; width: 86px; }
  table.items td.name { font-weight: 600; word-break: break-word; }
  table.items td.qty { width: 54px; font-weight: 600; }
  table.items td.money { width: 104px; font-variant-numeric: tabular-nums; }
  table.items td.strong { font-weight: 700; }
  .note { font-weight: 400; font-size: 11.5px; color: #4b5563; margin-top: 2px; }
  tr.gift td { color: #047857; }
  tr.gift .note { color: #047857; }
  .foot { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-top: 14px; }
  .count { font-size: 12px; color: #6b7280; padding-top: 6px; }
  table.totals { border-collapse: collapse; min-width: 300px; }
  table.totals td { padding: 3px 0 3px 18px; font-variant-numeric: tabular-nums; }
  table.totals td:first-child { padding-left: 0; color: #4b5563; }
  table.totals td:last-child { text-align: right; white-space: nowrap; }
  table.totals tr.discount td { color: #047857; }
  table.totals tr.total td { border-top: 2px solid #3E667D; padding-top: 8px; font-size: 19px; font-weight: 700; color: #3E667D; }
  table.totals tr.total .cur { font-size: 11px; font-weight: 600; color: #6b7280; }
  table.totals tr.minor td { font-size: 11.5px; color: #6b7280; }
  table.totals tr.save td { color: #047857; }
  .legend { margin-top: 18px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280; }
  @media print { table.items tr { page-break-inside: avoid; } }
</style></head><body><div class="sheet">
  <div class="head">
    ${opts.logoDataUrl ? `<img src="${opts.logoDataUrl}" alt="Tonic Life" />` : '<div class="brand">TONIC LIFE</div>'}
    <div class="title"><h1>COTIZACIÓN</h1><p>${esc(quoteDateLabel(payload.createdAt, payload.timezone))}</p></div>
  </div>
  <div class="info">${info}</div>
  <table class="items">
    <thead><tr><th class="c">#</th><th>Clave</th><th>Producto</th><th class="c">Cant.</th><th class="r">Precio</th><th class="r">Importe</th></tr></thead>
    <tbody>${rows}${gifts}</tbody>
  </table>
  <div class="foot">
    <div class="count">${payload.items.length} ${payload.items.length === 1 ? 'producto' : 'productos'} · ${pieces} ${pieces === 1 ? 'pieza' : 'piezas'}</div>
    <table class="totals"><tbody>${totals}${extras}</tbody></table>
  </div>
  <div class="legend">${esc(QUOTE_LEGEND)}</div>
</div></body></html>`;
}
