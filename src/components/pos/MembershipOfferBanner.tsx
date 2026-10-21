// MembershipOfferBanner - Banner de CAMPAÑA DE MEMBRESÍA ("Compra N puntos en
// producto y tu membresía de inscripción es GRATIS") para el distribuidor
// asignado, debajo de las promociones canjeables.
//
// Aparece solo cuando el API reporta al menos una campaña que HOY aplica a
// ese cliente en esta sucursal (nuevo pendiente sin kit, o básico que sube);
// el API ya filtró público, vigencia y "no usada". Muestra el avance de
// puntos EN PRODUCTO del ticket (misma regla que el servidor: sin kits,
// promos canjeables ni boletos de evento) hacia la oferta objetivo y, al
// cumplirla, deja `membershipCampaignId` en el carrito para que viaje al
// crear la venta. El servidor vuelve a validar y hace el resto: sube la
// posición al cobrar, agrega los regalos a $0 (descuentan existencia) y crea
// el cupón de primera recompra. Con un API sin la ruta (404) no hay ofertas
// y no se ve nada: el POS opera igual que hoy.

import { useEffect } from 'react';
import { Crown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useMembershipOffers } from '@/hooks/useMembership';
import { usePosCartStore } from '@/stores/pos-cart.store';
import {
  describeOfferBenefits,
  membershipPoints,
  nextOfferAbove,
  pickTargetOffer,
} from '@/lib/membership';

interface MembershipOfferBannerProps {
  customerId: string;
  /** Sucursal efectiva SOLO en modo staff (JWT de usuario); la terminal se
   *  identifica por su licencia y no debe mandarla. */
  branchId?: string;
}

const fmt = (n: number) =>
  n.toLocaleString('es-MX', { maximumFractionDigits: 0 });

export function MembershipOfferBanner({
  customerId,
  branchId,
}: MembershipOfferBannerProps) {
  const { data } = useMembershipOffers(customerId, branchId);
  const items = usePosCartStore((s) => s.cart.items);
  const selectedId = usePosCartStore((s) => s.cart.membershipCampaignId);
  const apply = usePosCartStore((s) => s.cart.applyMembership);
  const setMembershipCampaignId = usePosCartStore(
    (s) => s.setMembershipCampaignId,
  );
  const setApplyMembership = usePosCartStore((s) => s.setApplyMembership);

  const offers = data?.offers ?? [];
  const points = membershipPoints(items);
  // Objetivo: la oferta de MAYOR umbral que el ticket ya cumple; si no
  // cumple ninguna, la más cercana (menor umbral).
  const target = pickTargetOffer(offers, points);
  const qualifies = target != null && points >= target.minPoints;
  // Lo que debe quedar en el carrito: la campaña objetivo SOLO si el ticket
  // la cumple y el cajero no apagó "Aplicar en esta venta".
  const desiredId = qualifies && apply ? target.campaignId : null;

  // El carrito es la fuente de verdad para el cobro: se sincroniza cada vez
  // que cambian los puntos, la oferta o el interruptor, y se limpia si el
  // ticket deja de calificar o las ofertas desaparecen (p. ej. 404).
  useEffect(() => {
    if (selectedId !== desiredId) setMembershipCampaignId(desiredId);
  }, [selectedId, desiredId, setMembershipCampaignId]);

  if (!target) return null;

  const missing = Math.max(0, target.minPoints - points);
  const pct =
    target.minPoints > 0 ? Math.min(100, (points / target.minPoints) * 100) : 100;
  const next = nextOfferAbove(offers, target);
  const audience = target.audience ?? data?.customer?.audience ?? null;
  const audienceLabel =
    audience === 'new'
      ? 'Distribuidor nuevo: queda activo con esa posición al cobrar'
      : audience === 'basic'
        ? 'Sube de Básico al cobrar'
        : null;

  return (
    <div
      className={cn(
        'border-b px-4 py-2.5',
        qualifies
          ? 'bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50'
          : 'bg-gradient-to-r from-sky-50 via-cyan-50 to-sky-50',
      )}
      data-tour="pos-membership"
    >
      <div className="flex items-start gap-3">
        {target.imageUrl && (
          <img
            src={target.imageUrl}
            alt={target.name}
            className="size-14 shrink-0 rounded-md border bg-white object-contain p-0.5"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Crown className="size-4 shrink-0 text-emerald-700" />
            <span className="text-sm font-semibold text-emerald-900">
              Membresía gratis
            </span>
            <span className="font-mono text-xs font-bold text-emerald-700">
              {target.code}
            </span>
            <span className="truncate text-sm font-medium text-foreground">
              {target.name}
            </span>
            {qualifies ? (
              <Badge className="bg-emerald-600 text-white">¡Califica!</Badge>
            ) : (
              <span className="text-xs font-medium text-sky-800">
                te faltan {fmt(missing)} pts
              </span>
            )}
          </div>

          <div className="mt-1 flex items-center gap-2">
            <Progress
              value={pct}
              className={cn(
                'h-2 flex-1 bg-white/80',
                qualifies && '[&>[data-slot=progress-indicator]]:bg-emerald-500',
              )}
            />
            <span
              className="shrink-0 text-xs tabular-nums text-muted-foreground"
              title="Solo cuentan los puntos de producto: no los kits, promociones canjeables ni boletos de evento"
            >
              {fmt(points)} de {fmt(target.minPoints)} pts en producto
            </span>
          </div>

          <p className="mt-0.5 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">Incluye:</span>{' '}
            {describeOfferBenefits(target)}
          </p>
          {target.description && (
            <p
              className="truncate text-[11px] text-muted-foreground"
              title={target.description}
            >
              {target.description}
            </p>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px]">
            {audienceLabel && (
              <span className="text-muted-foreground">{audienceLabel}</span>
            )}
            {next && (
              <span className="text-muted-foreground">
                Con {fmt(Math.max(0, next.minPoints - points))} pts más:{' '}
                {next.name}
              </span>
            )}
            {qualifies && (
              <label className="ml-auto flex cursor-pointer items-center gap-1.5 font-medium text-emerald-900">
                <Checkbox
                  checked={apply}
                  onCheckedChange={(v) => setApplyMembership(v === true)}
                  aria-label="Aplicar la campaña de membresía en esta venta"
                />
                Aplicar en esta venta
              </label>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
