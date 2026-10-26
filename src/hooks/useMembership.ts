// useMembership.ts - Hooks de React Query para las campañas de membresía
// ("Compra N puntos en producto y tu membresía es GRATIS") del POS.

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { posApi } from '@/lib/posApi';
import { usePosCartStore } from '@/stores/pos-cart.store';
import {
  membershipBagStatus,
  membershipPoints,
  type MembershipBagStatus,
} from '@/lib/membership';
import type { PosMembershipOffer } from '@/types/pos';

export const membershipKeys = {
  all: ['membership'] as const,
  offers: (customerId: string, branchId?: string) =>
    [...membershipKeys.all, 'offers', customerId, branchId ?? 'terminal'] as const,
  active: (branchId?: string) =>
    [...membershipKeys.all, 'active', branchId ?? 'terminal'] as const,
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

/**
 * Campañas ENCENDIDAS en la sucursal (sin cliente): catálogo, botón
 * "Membresías" y bolsa del carrito. Cambian poco: se refrescan cada 5 min.
 */
export const useMembershipActive = (branchId?: string, enabled = true) =>
  useQuery({
    queryKey: membershipKeys.active(branchId),
    queryFn: () => posApi.getMembershipActive(branchId),
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });

export interface MembershipBag extends MembershipBagStatus {
  /** Campaña elegida (null = sin bolsa). */
  selectedId: string | null;
  offer: PosMembershipOffer | null;
  /** Puntos EN PRODUCTO del ticket. */
  points: number;
  /** Hay bolsa y todavía no se cumple: el cobro se bloquea. */
  blocking: boolean;
  remove: () => void;
}

/**
 * Estado de la "bolsa" de membresía elegida en el carrito y su efecto sobre
 * la venta: mientras no cumpla, `membershipCampaignId` queda en null; al
 * cumplir (vigente, distribuidor al que aplica, puntos) se fija para que
 * viaje al crear la venta. El banner automático no se muestra con bolsa.
 */
export function useMembershipBag(branchId?: string): MembershipBag {
  const selectedId = usePosCartStore((s) => s.cart.membershipSelectedId);
  const customerId = usePosCartStore((s) => s.cart.customerId);
  const items = usePosCartStore((s) => s.cart.items);
  const campaignId = usePosCartStore((s) => s.cart.membershipCampaignId);
  const setMembershipCampaignId = usePosCartStore(
    (s) => s.setMembershipCampaignId,
  );
  const setMembershipSelected = usePosCartStore((s) => s.setMembershipSelected);

  const { data: active, isLoading: loadingActive } = useMembershipActive(
    branchId,
    !!selectedId,
  );
  const { data: offersData } = useMembershipOffers(
    customerId,
    branchId,
    !!selectedId,
  );

  const offer = selectedId
    ? (active?.offers.find((o) => o.campaignId === selectedId) ?? null)
    : null;
  const points = membershipPoints(items);
  const eligible =
    !!selectedId &&
    (offersData?.offers.some((o) => o.campaignId === selectedId) ?? false);
  const status = membershipBagStatus({
    offer,
    loadingOffer: loadingActive || active === undefined,
    hasCustomer: !!customerId,
    offersLoaded: offersData !== undefined,
    eligible,
    customerReason: offersData?.customer?.reason ?? null,
    points,
  });

  // El carrito es la fuente de verdad para el cobro: con bolsa, la campaña
  // viaja solo cuando se cumple todo.
  const desiredId = selectedId && status.ready ? selectedId : null;
  useEffect(() => {
    if (!selectedId) return;
    if (campaignId !== desiredId) setMembershipCampaignId(desiredId);
  }, [selectedId, campaignId, desiredId, setMembershipCampaignId]);

  return {
    ...status,
    selectedId,
    offer,
    points,
    blocking: !!selectedId && !status.ready,
    remove: () => setMembershipSelected(null),
  };
}
