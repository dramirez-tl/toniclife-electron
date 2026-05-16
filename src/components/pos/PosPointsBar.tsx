// PosPointsBar - Progreso de puntos del distribuidor hacia la calificacion
// del periodo (3,300 pts). Portado de toniclife-next PosPointsBar.

import { Award, TrendingUp } from 'lucide-react';
import { useCustomerPeriodStats } from '@/hooks/usePos';

interface PosPointsBarProps {
  customerId: string;
  /** Puntos que aportaria la venta actual del carrito. */
  cartPoints: number;
}

export function PosPointsBar({ customerId, cartPoints }: PosPointsBarProps) {
  const { data: stats, isLoading } = useCustomerPeriodStats(customerId);

  if (isLoading || !stats) {
    return (
      <div className="px-4 py-2 border-b text-[11px] text-muted-foreground">
        Cargando puntos del periodo...
      </div>
    );
  }

  const threshold = stats.qualificationThreshold || 3300;
  const current = stats.personalPoints;
  const projected = current + cartPoints;
  const alreadyQualified = current >= threshold;
  const willQualify = !alreadyQualified && projected >= threshold;
  const pct = Math.min(100, (projected / threshold) * 100);
  const deficit = Math.max(0, threshold - projected);

  return (
    <div className="px-4 py-2.5 border-b">
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="flex items-center gap-1 text-muted-foreground">
          <Award className="size-3.5" />
          Puntos del periodo
        </span>
        {alreadyQualified ? (
          <span className="font-medium text-emerald-600">Calificado</span>
        ) : willQualify ? (
          <span className="font-medium text-primary">
            ¡Califica con esta venta!
          </span>
        ) : (
          <span className="text-muted-foreground">
            Faltan {deficit.toFixed(0)} pts
          </span>
        )}
      </div>

      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={[
            'h-full rounded-full transition-all',
            alreadyQualified || willQualify
              ? 'bg-emerald-500'
              : 'bg-primary',
          ].join(' ')}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-1">
        <span className="tabular-nums">
          {current.toFixed(0)}
          {cartPoints > 0 && (
            <span className="text-primary">
              {' '}
              + {cartPoints.toFixed(0)}
              <TrendingUp className="inline size-3 ml-0.5" />
            </span>
          )}
        </span>
        <span className="tabular-nums">meta {threshold.toLocaleString()}</span>
      </div>
    </div>
  );
}
