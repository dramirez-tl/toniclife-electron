// ConnectionStatus - Indicador de conectividad para la barra superior del POS.
// Muestra en linea / conexion lenta / sin conexion, a juego con el reloj.

import { Wifi, WifiLow, WifiOff } from 'lucide-react';
import {
  useConnectionStatus,
  type ConnectionQuality,
} from '@/hooks/useConnectionStatus';
import { cn } from '@/lib/utils';

const CONFIG: Record<
  ConnectionQuality,
  { Icon: typeof Wifi; label: string; className: string }
> = {
  online: { Icon: Wifi, label: 'En linea', className: 'text-emerald-300' },
  slow: { Icon: WifiLow, label: 'Conexion lenta', className: 'text-amber-300' },
  offline: { Icon: WifiOff, label: 'Sin conexion', className: 'text-red-300' },
};

export function ConnectionStatus({ className }: { className?: string }) {
  const { status, latency } = useConnectionStatus();
  const { Icon, label, className: colorClass } = CONFIG[status];

  return (
    <div
      className={cn('flex items-center gap-1.5 text-sm', colorClass, className)}
      title={latency != null ? `${label} · ${latency} ms` : label}
      role="status"
      aria-live="polite"
    >
      <Icon className="size-4" />
      <span>{label}</span>
    </div>
  );
}
