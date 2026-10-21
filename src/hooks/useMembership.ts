// useMembership.ts - Hooks de React Query para las campañas de membresía
// ("Compra N puntos en producto y tu membresía es GRATIS") del POS.

import { useQuery } from '@tanstack/react-query';
import { posApi } from '@/lib/posApi';

export const membershipKeys = {
  all: ['membership'] as const,
  offers: (customerId: string, branchId?: string) =>
    [...membershipKeys.all, 'offers', customerId, branchId ?? 'terminal'] as const,
};

/**
 * Campañas de membresía que HOY aplican al distribuidor asignado en la
 * sucursal efectiva. `branchId` SOLO en modo staff (JWT de usuario): la
 * terminal se identifica por su licencia. Con un API sin la ruta (404) el
 * cliente responde `{ offers: [], customer: null }` sin error: el banner
 * simplemente no aparece.
 */
export const useMembershipOffers = (
  customerId: string | undefined,
  branchId?: string,
  enabled = true,
) =>
  useQuery({
    queryKey: membershipKeys.offers(customerId ?? 'disabled', branchId),
    queryFn: () => posApi.getMembershipOffers(customerId!, branchId),
    enabled: !!customerId && enabled,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    // Un 403 (sucursal fuera de las asignaciones del staff) o un 500 no
    // merecen tres reintentos: sin ofertas no hay banner y ya.
    retry: 1,
  });
