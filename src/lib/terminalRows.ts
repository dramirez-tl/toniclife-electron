// terminalRows.ts - Desglose de ventas por TERMINAL (licencia POS = "caja").
//
// Compartido por el corte del día (desglose que manda el API en
// summary.byTerminal) y por "Ventas recientes" (desglose calculado aquí a
// partir de las ventas cargadas del rango). Una venta sin licencia es de
// modo staff / call center: se agrupa como "Sin terminal".

import { PosSaleStatus, type DailySalesTerminalRow, type Sale } from '@/types/pos';

export const SIN_TERMINAL = 'Sin terminal (call center)';

/** Clave de agrupación de la fila "sin terminal" (posLicenseId null). */
export const SIN_TERMINAL_KEY = '__sin_terminal__';

/** Valor del filtro de caja "todas" (panel de ventas y corte comparten el
 *  mismo estado: ALL_TERMINALS | SIN_TERMINAL_KEY | <posLicenseId>). */
export const ALL_TERMINALS = '__all__';

/** Opción del selector de caja: clave del filtro + etiqueta legible. */
export interface TerminalOption {
  key: string;
  label: string;
}

/** Parámetros que el API entiende para filtrar por caja (ventas y corte). */
export interface TerminalFilterParams {
  posLicenseId?: string;
  capturedVia?: 'terminal' | 'usuario';
}

/** Opciones del selector de caja a partir de un desglose por terminal (sin
 *  la opción "todas": cada selector la pinta con su propio texto). */
export function terminalOptionsFromRows(rows: TerminalRow[]): TerminalOption[] {
  return rows.map((t) => ({
    key: t.id ?? SIN_TERMINAL_KEY,
    label: t.id ? t.label : SIN_TERMINAL,
  }));
}

/** Etiqueta legible del filtro de caja (para subtítulos, ticket y CSV). */
export function terminalFilterLabel(
  filter: string,
  options: TerminalOption[],
): string {
  if (filter === ALL_TERMINALS) return 'Todas las cajas';
  if (filter === SIN_TERMINAL_KEY) return SIN_TERMINAL;
  return (
    options.find((o) => o.key === filter)?.label ??
    `Terminal ${filter.slice(-4)}`
  );
}

/** Traduce el filtro de caja a los parámetros del API: una licencia →
 *  posLicenseId; "sin terminal" → capturedVia=usuario; "todas" → nada. */
export function terminalFilterParams(filter: string): TerminalFilterParams {
  if (filter === ALL_TERMINALS) return {};
  if (filter === SIN_TERMINAL_KEY) return { capturedVia: 'usuario' };
  return { posLicenseId: filter };
}

export interface TerminalRow {
  /** posLicenseId; null = sin licencia (staff / call center). */
  id: string | null;
  label: string;
  /** Ventas COMPLETADAS (las canceladas van aparte). */
  salesCount: number;
  /** Importe de las ventas completadas. */
  amount: number;
  cancelledCount: number;
}

/** Nombre legible de una terminal: su etiqueta o, si no tiene, el final de
 *  la clave de licencia (`suffixLen` caracteres; el corte usa 9, el panel
 *  compacto de ventas usa 4). */
export function terminalName(
  label: string | null | undefined,
  licenseKey: string | null | undefined,
  suffixLen = 9,
): string {
  if (label && label.trim()) return label.trim();
  if (licenseKey) return `Terminal ${licenseKey.slice(-suffixLen)}`;
  return SIN_TERMINAL;
}

/** Nombre de la terminal que cobró una venta (o "Sin terminal"). */
export function saleTerminalName(s: Sale, suffixLen = 9): string {
  return s.posLicenseId
    ? terminalName(s.posLicenseLabel, s.posLicenseKey, suffixLen)
    : SIN_TERMINAL;
}

/** Valor del filtro de terminal de una venta: su licencia o la clave "sin
 *  terminal" (ventas capturadas con cuenta personal o sin licencia). */
export function saleTerminalKey(s: Sale): string {
  return s.posLicenseId ?? SIN_TERMINAL_KEY;
}

/** Filas del corte a partir del desglose que calcula el API. */
export function terminalRowsFromSummary(
  byTerminal: DailySalesTerminalRow[] | undefined,
): TerminalRow[] {
  return (byTerminal ?? []).map((t) => ({
    id: t.posLicenseId,
    label: terminalName(t.label, t.licenseKey),
    salesCount: Number(t.salesCount),
    amount: Number(t.totalAmount),
    cancelledCount: Number(t.cancelledCount),
  }));
}

/**
 * Agrupa ventas por terminal: tickets e importe de las COMPLETADAS y conteo
 * de canceladas (pendientes y reembolsos no suman). Orden: por importe
 * descendente, "Sin terminal" al final.
 */
export function aggregateTerminalRows(
  sales: Sale[],
  suffixLen = 4,
): TerminalRow[] {
  const map = new Map<string, TerminalRow>();
  for (const s of sales) {
    const key = saleTerminalKey(s);
    let row = map.get(key);
    if (!row) {
      row = {
        id: s.posLicenseId ?? null,
        label: saleTerminalName(s, suffixLen),
        salesCount: 0,
        amount: 0,
        cancelledCount: 0,
      };
      map.set(key, row);
    }
    if (s.status === PosSaleStatus.COMPLETED) {
      row.salesCount += 1;
      row.amount += Number(s.total) || 0;
    } else if (s.status === PosSaleStatus.CANCELLED) {
      row.cancelledCount += 1;
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.id === null) return 1;
    if (b.id === null) return -1;
    return b.amount - a.amount;
  });
}
