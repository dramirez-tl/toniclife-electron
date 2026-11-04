// seasonalApi.ts - Promociones de temporada (mig 186) para la terminal:
// GET /pos/seasonal-promotions → temporadas vigentes/próximas de la sucursal
// (apartado del catálogo) + definiciones para el motor local del carrito
// (lib/seasonalPromotions.ts). El API vuelve a aplicar las promociones al
// crear la venta; su resultado manda.

import axios from 'axios';
import { api } from './api';
import { resolveImageUrl } from './posApi';
import type { PosSeasonalBundle } from '@/types/pos';

const EMPTY: PosSeasonalBundle = {
  nowLocal: '',
  countryCode: 'MX',
  timezone: 'America/Mexico_City',
  seasons: [],
  defs: [],
};

class SeasonalApi {
  /**
   * Paquete de la sucursal. `branchId` solo en modo staff (JWT de usuario);
   * la terminal se identifica por su licencia. Un API sin el módulo (404) o
   * sin la migración (503) = sin temporadas: la terminal vende como siempre.
   */
  async getBundle(branchId?: string): Promise<PosSeasonalBundle> {
    try {
      const { data } = await api.get<PosSeasonalBundle>(
        '/pos/seasonal-promotions',
        { params: branchId ? { branchId } : {} },
      );
      if (!data || !Array.isArray(data.seasons)) return EMPTY;
      return {
        nowLocal: data.nowLocal ?? '',
        countryCode: data.countryCode || 'MX',
        timezone: data.timezone || 'America/Mexico_City',
        defs: Array.isArray(data.defs) ? data.defs : [],
        seasons: data.seasons.map((s) => ({
          ...s,
          imageUrl: resolveImageUrl(s.imageUrl ?? undefined) ?? null,
          imageThumbnailUrl:
            resolveImageUrl(s.imageThumbnailUrl ?? undefined) ?? null,
          promotions: (s.promotions ?? []).map((p) => ({
            ...p,
            imageUrl: resolveImageUrl(p.imageUrl ?? undefined) ?? null,
            imageThumbnailUrl:
              resolveImageUrl(p.imageThumbnailUrl ?? undefined) ?? null,
            products: (p.products ?? []).map((x) => ({
              ...x,
              imageUrl: resolveImageUrl(x.imageUrl ?? undefined) ?? null,
            })),
          })),
        })),
      };
    } catch (err) {
      if (
        axios.isAxiosError(err) &&
        (err.response?.status === 404 || err.response?.status === 503)
      ) {
        return EMPTY;
      }
      throw err;
    }
  }
}

export const seasonalApi = new SeasonalApi();
