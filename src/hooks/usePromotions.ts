// usePromotions.ts - Hooks de React Query para promociones del POS.

import { useQuery } from '@tanstack/react-query';
import { promotionsApi } from '@/lib/promotionsApi';

export const promotionKeys = {
  all: ['promotions'] as const,
  available: (customerId: string, branchId: string) =>
    [...promotionKeys.all, 'available', customerId, branchId] as const,
  current: (branchId: string) =>
    [...promotionKeys.all, 'current', branchId] as const,
  redeemed: (customerId: string, branchId: string) =>
    [...promotionKeys.all, 'redeemed', customerId, branchId] as const,
  reachable: (customerId: string, branchId: string, cartPoints: number) =>
    [...promotionKeys.all, 'reachable', customerId, branchId, cartPoints] as const,
};

/**
 * Promociones VIGENTES en el país de la sucursal (solo informativo, sin
 * cliente). Para el modal de mostrador.
 */
export const useCurrentPromotions = (branchId: string | undefined) => {
  return useQuery({
    queryKey: promotionKeys.current(branchId ?? 'disabled'),
    queryFn: () => promotionsApi.listCurrent(branchId!),
    enabled: !!branchId,
    // Sin staleTime: el query solo corre mientras el modal está abierto y
    // el mostrador debe ver SIEMPRE lo vigente (una promo/imagen recién
    // cambiada en admin aparecía hasta 5 min después por el cache).
    staleTime: 0,
    gcTime: 15 * 60 * 1000,
  });
};

/**
 * Lista las promociones canjeables HOY por el distribuidor en la sucursal.
 * Retorna [] si no hay distribuidor seleccionado.
 */
export const useAvailablePromotionsForCustomer = (
  customerId: string | undefined,
  branchId: string | undefined,
) => {
  return useQuery({
    queryKey:
      customerId && branchId
        ? promotionKeys.available(customerId, branchId)
        : promotionKeys.available('disabled', 'disabled'),
    queryFn: () =>
      promotionsApi.listAvailableForCustomer(customerId!, branchId!),
    enabled: !!customerId && !!branchId,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

/**
 * Promos que el distribuidor ALCANZARÍA con los puntos del carrito (canje en
 * la misma compra, 27-oct-2026). Se reconsulta cuando cambian los puntos del
 * carrito; con 0 puntos no se consulta.
 */
export const useReachablePromotionsForCustomer = (
  customerId: string | undefined,
  branchId: string | undefined,
  cartPoints: number,
) => {
  const pts = Math.max(0, Math.round(cartPoints || 0));
  return useQuery({
    queryKey:
      customerId && branchId
        ? promotionKeys.reachable(customerId, branchId, pts)
        : promotionKeys.reachable('disabled', 'disabled', 0),
    queryFn: () =>
      promotionsApi.listReachableForCustomer(customerId!, branchId!, pts),
    enabled: !!customerId && !!branchId && pts > 0,
    placeholderData: (prev) => prev,
    staleTime: 15 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

/**
 * Promos YA CANJEADAS por el distribuidor (recientes), con sucursal/folio/
 * fecha del cobro — para avisar en mostrador dónde se cobró.
 */
export const useRedeemedPromotionsForCustomer = (
  customerId: string | undefined,
  branchId: string | undefined,
) => {
  return useQuery({
    queryKey:
      customerId && branchId
        ? promotionKeys.redeemed(customerId, branchId)
        : promotionKeys.redeemed('disabled', 'disabled'),
    queryFn: () =>
      promotionsApi.listRedeemedForCustomer(customerId!, branchId!),
    enabled: !!customerId && !!branchId,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};
