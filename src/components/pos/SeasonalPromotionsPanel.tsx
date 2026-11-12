// SeasonalPromotionsPanel - Apartado "Promociones de temporada" del catálogo
// (mig 186): temporadas en curso o próximas de la sucursal con su arte, las
// promociones del día (tipo, nombre, horario local) y los productos que
// participan como chips que se agregan al carrito. El motor local del
// carrito aplica la promoción sola (3x2, precio especial…) cuando llega la
// hora; aquí solo se muestra y se facilita agregar.

import { useMemo, useState } from 'react';
import { Sparkles, Clock, Gift, ZoomIn, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { PosSeason, PosSeasonPromotion, PosSeasonalBundle, QuickProduct } from '@/types/pos';
import { ImageLightbox } from './ImageLightbox';

interface SeasonalPromotionsPanelProps {
  bundle: PosSeasonalBundle | undefined;
  catalog: QuickProduct[];
  onAdd: (product: QuickProduct) => void;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/** 'YYYY-MM-DDTHH:mm:ss' (hora local) → "vie 13 nov 00:00" sin pasar por Date. */
export function formatSeasonStamp(stamp: string | null | undefined): string {
  if (!stamp) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(stamp);
  if (!m) return stamp;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const wd = WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  const time = m[4] ? ` ${m[4]}:${m[5]}` : '';
  return `${wd} ${d} ${MONTHS[mo - 1] ?? ''}${time}`;
}

/** ¿La promoción corre ahora? (hora local del paquete, comparación de texto). */
function isPromoLive(p: PosSeasonPromotion, nowLocal: string): boolean {
  if (!nowLocal) return false;
  return p.effectiveStartsAt <= nowLocal && nowLocal <= p.effectiveEndsAt;
}

export function SeasonalPromotionsPanel({ bundle, catalog, onAdd }: SeasonalPromotionsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [lightbox, setLightbox] = useState<{ src?: string; title: string } | null>(null);
  const byId = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog]);
  const seasons = bundle?.seasons ?? [];
  if (seasons.length === 0) return null;
  const nowLocal = bundle?.nowLocal ?? '';

  const addProduct = (productId: string, name: string) => {
    const product = byId.get(productId);
    if (!product) {
      toast.warning(`${name} no está en el catálogo de esta sucursal`);
      return;
    }
    onAdd(product);
  };

  return (
    <div className="mb-4 space-y-2" data-tour="pos-seasonal">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center justify-between rounded-md px-1 text-left"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-[#2f5165]">
          Promociones de temporada
        </span>
        {collapsed ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronUp className="size-4 text-muted-foreground" />}
      </button>
      {!collapsed &&
        seasons.map((s) => <SeasonCard key={s.id} season={s} nowLocal={nowLocal} onAdd={addProduct} onZoom={setLightbox} byId={byId} />)}
      <ImageLightbox
        open={!!lightbox}
        onClose={() => setLightbox(null)}
        src={lightbox?.src}
        alt={lightbox?.title ?? ''}
        title={lightbox?.title ?? ''}
      />
    </div>
  );
}

function SeasonCard({
  season,
  nowLocal,
  onAdd,
  onZoom,
  byId,
}: {
  season: PosSeason;
  nowLocal: string;
  onAdd: (productId: string, name: string) => void;
  onZoom: (v: { src?: string; title: string }) => void;
  byId: Map<string, QuickProduct>;
}) {
  const active = season.status === 'active';
  const promos = season.promotions ?? [];
  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        active ? 'border-[#a7c1e2] bg-[#C8DDF2]/25' : 'border-dashed border-gray-300 bg-muted/30',
      )}
    >
      <div className="flex items-start gap-3">
        {season.imageUrl ? (
          <button
            type="button"
            onClick={() => onZoom({ src: season.imageUrl ?? undefined, title: season.name })}
            className="group relative h-16 w-24 shrink-0 overflow-hidden rounded-md border bg-white"
            title="Ver el arte de la temporada en grande"
          >
            <img src={season.imageThumbnailUrl ?? season.imageUrl} alt={season.name} className="size-full object-cover" />
            <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100">
              <ZoomIn className="size-4" />
            </span>
          </button>
        ) : (
          <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-md border bg-white text-[#2f5165]">
            <Sparkles className="size-6" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-foreground">{season.name}</span>
            {active ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                <Sparkles className="size-3" /> En curso
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-700">
                <Clock className="size-3" /> Empieza {formatSeasonStamp(season.startsAt)}
              </span>
            )}
          </div>
          {season.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground" title={season.description}>
              {season.description}
            </p>
          )}
        </div>
      </div>

      <ul className="mt-2 space-y-2">
        {promos.map((p) => {
          const live = isPromoLive(p, nowLocal);
          const eligible = p.products.filter((x) => x.role === 'eligible');
          const gifts = p.products.filter((x) => x.role === 'gift');
          return (
            <li key={p.id} className={cn('rounded-md border bg-white p-2', live ? 'border-emerald-300' : 'border-gray-200')}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold text-white', live ? 'bg-emerald-600' : 'bg-[#3E667D]')}>
                  {p.typeLabel}
                </span>
                <span className="text-sm font-medium text-foreground">{p.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {formatSeasonStamp(p.effectiveStartsAt)} → {formatSeasonStamp(p.effectiveEndsAt)}
                  {live ? ' · ahora' : ''}
                </span>
                {p.excludesKitBonus && (
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">Sin bono</span>
                )}
                {live && p.type === 'nxm' && (
                  <span
                    className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800"
                    title="Al llegar a las piezas que se pagan, la pieza gratis se agrega sola al carrito"
                  >
                    La pieza gratis entra sola
                  </span>
                )}
              </div>
              {p.description && (
                <p className="mt-0.5 whitespace-pre-line text-[11px] text-muted-foreground">{p.description}</p>
              )}
              <div className="mt-1.5 flex flex-wrap gap-1">
                {eligible.map((x) => {
                  const inCatalog = byId.has(x.productId);
                  return (
                    <button
                      key={x.productId}
                      type="button"
                      onClick={() => onAdd(x.productId, x.name)}
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[11px]',
                        inCatalog
                          ? 'border-gray-300 bg-white text-foreground hover:border-[#2f5165] hover:text-[#2f5165]'
                          : 'border-dashed border-gray-300 text-muted-foreground',
                      )}
                      title={inCatalog ? `Agregar ${x.name} al carrito` : 'No está en el catálogo de esta sucursal'}
                    >
                      <span className="font-mono text-[10px] text-muted-foreground">{x.sku}</span> {x.name}
                    </button>
                  );
                })}
                {gifts.map((g) => (
                  <span
                    key={`g-${g.productId}`}
                    className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-900"
                  >
                    <Gift className="size-3" /> Regalo: {g.quantity > 1 ? `${g.quantity} × ` : ''}
                    {g.name}
                  </span>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
