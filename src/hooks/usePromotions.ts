// usePromotions.ts - Hooks de React Query para promociones del POS.

import { useQuery } from '@tanstack/react-query';
import { promotionsApi } from '@/lib/promotionsApi';

export const promotionKeys = {
  all: ['promotions'] as const,
  available: (customerId: string, branchId: string) =>
    [...promotionKeys.all, 'available', customerId, branchId] as const,
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
