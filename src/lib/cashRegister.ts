// cashRegister.ts - Caja registradora de la sucursal al cobrar.
//
// El POS no tiene apertura manual: al cobrar, ensureSession (PosScreen) busca
// la sesión activa y, si no hay, abre una con la primera caja de
// GET /pos/registers/available y fondo 0. Una sucursal dada de alta desde el
// admin puede quedar SIN caja (incidente 23-sep-2026, sucursal 428): sin caja
// no hay sesión y no se puede cobrar. Aquí vive el reintento corto y el aviso
// accionable para ese caso; no usa endpoints nuevos.

/** Espera antes del único reintento de la consulta de cajas. */
export const REGISTER_RETRY_DELAY_MS = 1_500;

/** Aviso para el cajero cuando la sucursal no tiene caja registradora. */
export function noCashRegisterMessage(branch: {
  code?: string;
  name?: string;
}): string {
  const label =
    [branch.code?.trim(), branch.name?.trim()].filter(Boolean).join(' — ') ||
    'actual';
  return (
    `La sucursal ${label} no tiene caja registradora. ` +
    "Sistemas: en Admin > Sucursales usa 'Crear caja principal'. " +
    'La venta no se cobró; puedes intentarlo de nuevo en cuanto exista.'
  );
}

/**
 * Consulta las cajas de la sucursal y, si vienen vacías, reintenta UNA vez
 * tras `REGISTER_RETRY_DELAY_MS`. Cubre carreras (la caja se está creando en
 * ese momento, p. ej. por la autocuración del API en la primera consulta).
 * Los errores de red/HTTP se propagan igual que antes (sin reintento).
 */
export async function getRegistersWithRetry<T>(
  fetchRegisters: () => Promise<T[]>,
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T[]> {
  const first = await fetchRegisters();
  if (first.length > 0) return first;
  await wait(REGISTER_RETRY_DELAY_MS);
  return fetchRegisters();
}
