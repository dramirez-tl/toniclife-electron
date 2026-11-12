// usePickupOrdersAlert.ts - Aviso de que llegó un pedido en línea para
// recoger en la sucursal: toast de 10 s con el botón "Ver" y un pitido corto.
// Avisa solo cuando aparece un pedido por surtir que no venía en la consulta
// anterior (nunca en la primera carga ni al cambiar de sucursal).

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { newPickupOrders, newPickupOrdersToast } from '@/lib/pickupOrders';
import type { PickupOrdersResponse } from '@/types/pickupOrders';

/** Dos tonos cortos con WebAudio. Nunca lanza: si el equipo no tiene audio,
 *  el aviso visual basta. */
function playNewOrderBeep(): void {
  try {
    const Ctx: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    void ctx.resume().catch(() => undefined);
    const start = ctx.currentTime + 0.02;
    const tone = (frequency: number, at: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      // Subida y bajada suaves para que no truene la bocina.
      gain.gain.setValueAtTime(0.0001, start + at);
      gain.gain.exponentialRampToValueAtTime(0.25, start + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + at + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start + at);
      osc.stop(start + at + duration + 0.02);
    };
    tone(880, 0, 0.16);
    tone(1175, 0.2, 0.24);
    window.setTimeout(() => {
      void ctx.close().catch(() => undefined);
    }, 1000);
  } catch {
    /* sin audio */
  }
}

/**
 * Vigila la consulta de pedidos para recoger (`data` de usePickupOrders) y
 * avisa cuando llega uno nuevo. `onView` abre la hoja de pedidos.
 */
export function usePickupOrdersAlert(
  data: PickupOrdersResponse | null | undefined,
  onView: () => void,
): void {
  const previous = useRef<PickupOrdersResponse | null>(null);
  const onViewRef = useRef(onView);
  useEffect(() => {
    onViewRef.current = onView;
  }, [onView]);

  useEffect(() => {
    // Sin datos (cargando, sin acceso o API anterior) no hay con qué comparar;
    // se conserva la última consulta buena.
    if (!data) return;
    const arrived = newPickupOrders(previous.current, data);
    previous.current = data;
    if (arrived.length === 0) return;
    const { title, description } = newPickupOrdersToast(arrived);
    toast.info(title, {
      id: 'pickup-orders-new',
      description,
      duration: 10_000,
      action: { label: 'Ver', onClick: () => onViewRef.current() },
    });
    playNewOrderBeep();
  }, [data]);
}
