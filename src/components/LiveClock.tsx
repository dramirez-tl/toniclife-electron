// LiveClock - Reloj en vivo con la zona horaria de la sucursal.
// Opcionalmente muestra tambien la fecha (apilada sobre la hora).

import { useEffect, useState } from 'react';

interface LiveClockProps {
  timezone?: string;
  /** Estilos de la hora. */
  className?: string;
  /** Muestra la fecha encima de la hora. */
  showDate?: boolean;
  /** Estilos de la fecha (cuando showDate). */
  dateClassName?: string;
}

/** Formatea `now` con las opciones dadas, cayendo a la hora local si la
 *  zona horaria es invalida. */
function formatIn(
  now: Date,
  timezone: string | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  try {
    return new Intl.DateTimeFormat('es-MX', {
      ...options,
      timeZone: timezone || undefined,
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat('es-MX', options).format(now);
  }
}

export function LiveClock({
  timezone,
  className,
  showDate,
  dateClassName,
}: LiveClockProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const time = formatIn(now, timezone, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  if (!showDate) {
    return (
      <span className={`font-mono tabular-nums ${className ?? ''}`}>{time}</span>
    );
  }

  const date = formatIn(now, timezone, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div className="flex flex-col leading-tight">
      <span className={`capitalize ${dateClassName ?? ''}`}>{date}</span>
      <span className={`font-mono tabular-nums ${className ?? ''}`}>{time}</span>
    </div>
  );
}
