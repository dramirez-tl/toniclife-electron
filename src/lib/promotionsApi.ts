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
    const { data } = await api.get<AvailablePromotionForCustomer[]>(
      `/promotions/available/${customerId}`,
      { params: { branchId } },
    );
    return data;
  }
}

export const promotionsApi = new PromotionsApi();
