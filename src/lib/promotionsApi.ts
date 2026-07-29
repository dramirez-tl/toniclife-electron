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

/** Promoción vigente en el país de la sucursal (solo informativo). */
export interface CurrentPromotion {
  productId: string;
  code: string;
  name: string;
  shortName?: string;
  description?: string;
  /** Puntos personales del periodo requeridos para ganar el derecho. */
  minPointsRequired: number;
  /** Días de vigencia del derecho desde que se gana. */
  validityDays: number;
  /** 'per_period' = cada periodo; 'one_time' = una sola vez. */
  recurrence: string;
  /** Ventana de disponibilidad (YYYY-MM-DD); ausente = sin límite. */
  availableFrom?: string;
  availableTo?: string;
  /** Si al canjear se descuentan los puntos del periodo. */
  consumesPoints: boolean;
  /** Qué incluye la promo EN ESTE PAÍS (BoM por país). */
  items: Array<{ code: string; name: string; quantity: number }>;
}

class PromotionsApi {
  /**
   * Promociones VIGENTES en el país de la sucursal — solo informativo para
   * mostrador (qué promos corren hoy, puntos y qué incluyen). El backend
   * resuelve el país desde la licencia de la terminal (o branchId).
   */
  async listCurrent(branchId: string): Promise<CurrentPromotion[]> {
    const { data } = await api.get<CurrentPromotion[]>(
      '/pos/promotions/current',
      { params: { branchId } },
    );
    return data;
  }

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
