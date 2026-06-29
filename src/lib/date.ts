// date.ts - Helpers de fecha para el POS.
//
// IMPORTANTE: las fechas/horas se muestran en la ZONA HORARIA DE LA SUCURSAL
// (session.branch.timezone, ej. America/Chicago para Tulsa), NO la de la máquina.
// Si no se pasa tz, se usa la del equipo (fallback). Intl lanza con tz inválida,
// por eso se hace try/catch cayendo al comportamiento local.

/** Fecha YYYY-MM-DD de "hoy" en la zona horaria dada (o la del equipo). */
export function todayLocal(timeZone?: string): string {
  try {
    // 'en-CA' formatea como YYYY-MM-DD.
    return new Date().toLocaleDateString('en-CA', timeZone ? { timeZone } : {});
  } catch {
    return new Date().toLocaleDateString('en-CA');
  }
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
