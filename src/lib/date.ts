// date.ts - Helpers de fecha para el POS.

/** Fecha local de hoy en formato YYYY-MM-DD (zona horaria del equipo). */
export function todayLocal(): string {
  // 'en-CA' formatea como YYYY-MM-DD.
  return new Date().toLocaleDateString('en-CA');
}

/** Hora local HH:MM de un ISO timestamp. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Fecha + hora legible de un ISO timestamp. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
