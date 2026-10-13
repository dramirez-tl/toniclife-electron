// kitComponents.ts — Contenido ("Incluye") de kits/paquetes/promos para el
// carrito, el ticket y la reimpresión.
//
// Las sucursales reportaron tickets de PROMO152 sin "Incluye": el POS
// consultaba el endpoint público (todos los renglones, todos los países) y
// filtraba por el país de la sucursal resuelto con OTRA llamada; si esa
// resolución fallaba o venía vacía, la línea salía sin contenido. Ahora:
//   1. Se usa GET /pos/products/:id/components (el API resuelve país →
//      global por la sucursal) y SOLO si el API es anterior (404) se cae al
//      endpoint público con el filtro por país de siempre.
//   2. Caché en memoria por sesión: cada producto se consulta una vez por
//      sucursal efectiva (modo staff puede cambiar de sucursal).
//   3. Tolerante: un fallo nunca bloquea el ticket (la línea sale sin
//      contenido) y no se cachea, para reintentar en la siguiente venta.

import { posApi } from './posApi';
import type { KitComponent } from '@/types/pos';

/** Tipos de producto que llevan contenido en el ticket. */
export function isKitLikeType(productType?: string | null): boolean {
  return (
    productType === 'kit' ||
    productType === 'pack' ||
    productType === 'promotional'
  );
}

export interface ComponentsContext {
  /** Sucursal efectiva SOLO en modo staff (JWT de usuario); la terminal se
   *  identifica por su licencia y el API ignora/no necesita el branchId. */
  branchId?: string;
  /** ISO-2 del país de la sucursal: solo para el fallback al endpoint
   *  público (API anterior). */
  branchCountryCode?: string;
}

// Caché por sucursal efectiva + producto. Se guarda la PROMESA para que dos
// llamadas simultáneas (efecto del carrito + cobro) compartan una petición.
const cache = new Map<string, Promise<KitComponent[]>>();

// El fallback necesita el UUID del país: se resuelve una vez por sesión.
let activeCountriesPromise: Promise<
  Array<{ id: string; code: string }>
> | null = null;

async function resolveCountryId(
  branchCountryCode?: string,
): Promise<string | undefined> {
  if (!branchCountryCode) return undefined;
  activeCountriesPromise ??= posApi.getActiveCountries().catch(() => {
    activeCountriesPromise = null;
    return [];
  });
  const countries = await activeCountriesPromise;
  return countries.find(
    (c) => c.code?.toUpperCase() === branchCountryCode.toUpperCase(),
  )?.id;
}

const cacheKey = (productId: string, ctx: ComponentsContext): string =>
  `${ctx.branchId ?? 'terminal'}|${productId}`;

/**
 * Contenido del producto (cantidades POR UNIDAD). [] si no tiene. Lanza si
 * ninguna fuente respondió: el llamador decide si lo ignora.
 */
export function fetchKitComponents(
  productId: string,
  ctx: ComponentsContext = {},
): Promise<KitComponent[]> {
  const key = cacheKey(productId, ctx);
  const hit = cache.get(key);
  if (hit) return hit;

  const promise = (async () => {
    const fromPos = await posApi.getPosProductComponents(productId, ctx.branchId);
    if (fromPos) return fromPos;
    // API anterior sin la ruta: endpoint público + filtro por país.
    const countryId = await resolveCountryId(ctx.branchCountryCode);
    return posApi.getKitComponents(productId, countryId);
  })();

  cache.set(key, promise);
  promise.catch(() => cache.delete(key));
  return promise;
}

/**
 * Resuelve el contenido de varias líneas en paralelo (una petición por
 * producto único). Las que ya traen `components` se respetan; un fallo deja
 * esa línea sin contenido, nunca rechaza.
 */
export async function resolveComponentsForLines(
  lines: Array<{
    productId: string;
    productType?: string | null;
    components?: KitComponent[];
  }>,
  ctx: ComponentsContext = {},
  opts: { onlyKitLike?: boolean } = {},
): Promise<Map<string, KitComponent[]>> {
  const result = new Map<string, KitComponent[]>();
  const pending = new Set<string>();
  for (const line of lines) {
    if (line.components && line.components.length > 0) {
      result.set(line.productId, line.components);
      continue;
    }
    if (opts.onlyKitLike !== false && !isKitLikeType(line.productType)) continue;
    if (line.components && line.components.length === 0) continue; // ya se consultó: vacío
    pending.add(line.productId);
  }
  await Promise.all(
    [...pending].map(async (pid) => {
      const comps = await fetchKitComponents(pid, ctx).catch(() => []);
      if (comps.length > 0) result.set(pid, comps);
    }),
  );
  return result;
}

/**
 * Línea "Incluye: 1 x A, 1 x B" para el carrito; `truncated` se corta con "…"
 * pasado `max` caracteres (el texto completo va en el title).
 */
export function formatIncludes(
  components: KitComponent[],
  max = 60,
): { full: string; truncated: string } {
  const full =
    'Incluye: ' +
    components.map((c) => `${c.quantity} x ${c.name}`).join(', ');
  const truncated =
    full.length > max ? full.slice(0, Math.max(0, max - 1)).trimEnd() + '…' : full;
  return { full, truncated };
}

/** Solo para pruebas: limpia la caché de la sesión. */
export function __clearKitComponentsCache(): void {
  cache.clear();
  activeCountriesPromise = null;
}
