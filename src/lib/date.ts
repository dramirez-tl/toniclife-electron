// date.ts - Helpers de fecha para el POS.
//
// IMPORTANTE: las fechas/horas se muestran en la ZONA HORARIA DE LA SUCURSAL
// (session.branch.timezone, ej. America/Chicago para Tulsa), NO la de la máquina.
// Si no se pasa tz, se usa la del equipo (fallback). Intl lanza con tz inválida,
// por eso se hace try/catch cayendo al comportamiento local.

// Formateadores YYYY-MM-DD por zona horaria. Construir un Intl.DateTimeFormat
// es ~60x más caro que usarlo; la lista de ventas (hasta 5000 filas) lo llama
// por fila en cada render, así que se cachea por tz. '' = tz del equipo.
const ymdFormatters = new Map<string, Intl.DateTimeFormat>();

function ymdFormatter(timeZone?: string): Intl.DateTimeFormat {
  const key = timeZone ?? '';
  let f = ymdFormatters.get(key);
  if (!f) {
    try {
      // 'en-CA' formatea como YYYY-MM-DD.
      f = new Intl.DateTimeFormat('en-CA', timeZone ? { timeZone } : {});
    } catch {
      // tz inválida: Intl lanza; se cae a la zona del equipo.
      f = new Intl.DateTimeFormat('en-CA');
    }
    ymdFormatters.set(key, f);
  }
  return f;
}

/** Fecha YYYY-MM-DD de "hoy" en la zona horaria dada (o la del equipo). */
export function todayLocal(timeZone?: string): string {
  return localDateOf(new Date(), timeZone);
}

/** Fecha YYYY-MM-DD de un instante (ISO o Date) en la zona horaria dada (o la
 *  del equipo). Es el "día local de la sucursal" de una venta: el mismo
 *  criterio que usa el API para la factura global y el mes natural. */
export function localDateOf(when: string | Date, timeZone?: string): string {
  const d = when instanceof Date ? when : new Date(when);
  return ymdFormatter(timeZone).format(d);
}

/**
 * ¿`value` es una fecha YYYY-MM-DD real (existe en el calendario) con el año
 * dentro de [minYear, maxYear]? Un <input type="date"> manda años a medias
 * mientras se teclean ("0002", "0020", "0202"…): esos NO son fechas válidas
 * para el negocio y no deben aplicarse (15-oct-2026: el rango de "Ventas
 * recientes" quedó en el año 0026 y el POS no dejaba salir).
 */
export function isSaneIsoDate(
  value: string,
  minYear: number,
  maxYear: number,
): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < minYear || y > maxYear || mo < 1 || mo > 12 || d < 1) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/**
 * Año de 2 dígitos tecleado ("0026-10-15") → año completo. `future` = 20xx
 * (fechas de operación); `past` = 20xx salvo que pase de `maxYear`, entonces
 * 19xx (fechas de nacimiento: "0088" → 1988). null si no es YYYY-MM-DD o el
 * año ya trae 3-4 dígitos significativos (no se adivina).
 */
export function normalizeTwoDigitYear(
  value: string,
  mode: 'future' | 'past',
  maxYear: number,
): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!m) return null;
  const y = Number(m[1]);
  if (y >= 100) return null;
  const full = mode === 'past' && 2000 + y > maxYear ? 1900 + y : 2000 + y;
  return `${full}-${m[2]}-${m[3]}`;
}

/** Suma `days` días a una fecha YYYY-MM-DD (aritmética en UTC: sin DST). */
export function addDaysIso(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Días entre dos fechas YYYY-MM-DD (to - from); negativo si from > to. */
export function daysBetweenIso(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  );
}

/** Hora HH:MM de un ISO timestamp en la zona horaria dada (o la del equipo). */
export function formatTime(iso: string, timeZone?: string): string {
  try {
    return new Date(iso).toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      ...(timeZone ? { timeZone } : {}),
    });
  } catch {
    return new Date(iso).toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}

/** Fecha + hora legible de un ISO timestamp en la zona horaria dada. */
export function formatDateTime(iso: string, timeZone?: string): string {
  try {
    return new Date(iso).toLocaleString('es-MX', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      ...(timeZone ? { timeZone } : {}),
    });
  } catch {
    return new Date(iso).toLocaleString('es-MX', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
