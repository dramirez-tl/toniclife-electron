// promotionsApi.ts - Cliente HTTP del modulo Promociones contra toniclife-api.
//
// Solo expone las operaciones que el POS necesita en runtime: listar las
// promos canjeables HOY por un distribuidor en la sucursal actual. El
// backend resuelve el pais desde branchId, asi el Electron no necesita
// saber el UUID del pais.

import { api } from './api';

export interface AvailablePromotionForCustomer {
  productId: string;
  code: string;
  name: string;
  description?: string;
  minPointsRequired: number;
  currentPoints: number;
  consumesPoints: boolean;
  /** Cuántos derechos activos no vencidos tiene de esta promo (≥1). */
  availableCount?: number;
  /** Vencimiento del próximo derecho a vencer (ISO). */
  expiresAt?: string;
  /** Productos que incluye la promo (BoM). */
  items?: Array<{ code: string; name: string; quantity: number }>;
}

class PromotionsApi {
  /**
   * Lista promociones que el cliente puede canjear HOY en la sucursal.
   * El backend resuelve country_id desde branchId.
   */
  async listAvailableForCustomer(
    customerId: string,
    branchId: string,
  ): Promise<AvailablePromotionForCustomer[]> {
    // Endpoint bajo /pos (PosAccessGuard) — acepta el device token de la
    // terminal. El endpoint público /promotions/available es solo para
    // usuarios admin y rechazaría el token de terminal con 401.
    const { data } = await api.get<AvailablePromotionForCustomer[]>(
      `/pos/promotions/available/${customerId}`,
      { params: { branchId } },
    );
    return data;
  }
}

export const promotionsApi = new PromotionsApi();
