// useSeasonalPromotions.ts - Promociones de temporada (mig 186) en la
// terminal: paquete de la sucursal (temporadas para el catálogo + definiciones
// para el motor local). Se refresca cada minuto para que la promo del día
// entre y salga a su hora local sin reiniciar el POS.

import { useQuery } from '@tanstack/react-query';
import { seasonalApi } from '@/lib/seasonalApi';

export const seasonalKeys = {
  all: ['seasonal-promotions'] as const,
  bundle: (branchId?: string) =>
    [...seasonalKeys.all, 'bundle', branchId ?? 'terminal'] as const,
};

/** `branchId` solo en modo staff (JWT de usuario); la terminal va por licencia. */
export const useSeasonalBundle = (branchId?: string, enabled = true) =>
  useQuery({
    queryKey: seasonalKeys.bundle(branchId),
    queryFn: () => seasonalApi.getBundle(branchId),
    enabled,
    staleTime: 30 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchInterval: 60 * 1000,
    retry: 1,
  });
