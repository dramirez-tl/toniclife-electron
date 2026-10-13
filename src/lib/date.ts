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
