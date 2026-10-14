// Texto corto del evento al que pertenece una clave (tarjeta del catálogo y
// línea del carrito): "Titular · FOCADE Teziutlán 2026 · 15 oct".
import type { PosEventInfo } from '@/types/pos';

/** "15 oct" a partir de YYYY-MM-DD (fecha de negocio: sin zona horaria). */
export function formatEventDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd ?? '');
  if (!m) return ymd ?? '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d
    .toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
    .replace('.', '');
}

export function eventLine(ev: PosEventInfo): string {
  return [ev.label || null, ev.name, formatEventDate(ev.eventDate)]
    .filter(Boolean)
    .join(' · ');
}
