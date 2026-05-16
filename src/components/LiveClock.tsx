// LiveClock - Reloj en vivo con la zona horaria de la sucursal.

import { useEffect, useState } from 'react';

interface LiveClockProps {
  timezone?: string;
  className?: string;
}

export function LiveClock({ timezone, className }: LiveClockProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  let time: string;
  try {
    time = new Intl.DateTimeFormat('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: timezone || undefined,
    }).format(now);
  } catch {
    // timezone invalida -> hora local
    time = new Intl.DateTimeFormat('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(now);
  }

  return (
    <span className={`font-mono tabular-nums ${className ?? ''}`}>{time}</span>
  );
}
