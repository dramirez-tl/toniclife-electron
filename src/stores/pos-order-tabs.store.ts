// stores/pos-order-tabs.store.ts — Pestañas de pedidos del POS (modo staff).
// Call Center atiende varias llamadas a la vez: cada pestaña es un pedido con
// su carrito, su distribuidor y su entrega a domicilio. La pestaña ACTIVA vive
// en el store del carrito (+ el estado de entrega en PosScreen); las demás
// quedan "estacionadas" aquí como snapshot y se restauran al volver a ellas.
// Solo memoria: al cerrar el POS, cambiar de sucursal o salir del modo staff
// se descartan (igual que el carrito).

import { create } from 'zustand';
import type { PosCart } from '@/types/pos';
import type { DeliveryDraft } from '@/types/deliveries';

export interface OrderTabSnapshot {
  cart: PosCart;
  delivery: DeliveryDraft | null;
  deliveryMode: boolean;
  consolidated: boolean;
}

export interface OrderTab {
  id: string;
  /** Número visible ("Pedido 3"); no se reutiliza dentro de la sesión. */
  seq: number;
  /** Estado guardado mientras NO es la activa (null en la activa). */
  parked: OrderTabSnapshot | null;
}

interface OrderTabsStore {
  tabs: OrderTab[];
  activeId: string;
  nextSeq: number;
  /** Estaciona la activa y abre una pestaña nueva vacía. Con la activa
   *  vacía no hace nada (devuelve false): esa pestaña ya sirve para el
   *  pedido nuevo. */
  openTab: (current: OrderTabSnapshot) => boolean;
  /** Estaciona la activa y activa la destino; devuelve lo que hay que
   *  restaurar (null = empezar vacía) o undefined si no hubo cambio. Una
   *  pestaña activa VACÍA se descarta al salir de ella (no se acumulan). */
  switchTab: (
    targetId: string,
    current: OrderTabSnapshot,
  ) => OrderTabSnapshot | null | undefined;
  /** Cierra una pestaña. Si era la activa, pasa a la vecina y devuelve lo
   *  que hay que restaurar (null = vacía); si no era la activa devuelve
   *  undefined (nada cambia en pantalla). */
  closeTab: (id: string) => OrderTabSnapshot | null | undefined;
  /** Una sola pestaña vacía (cambio de sucursal, entrar/salir del modo staff). */
  reset: () => void;
}

/** Sin productos, sin distribuidor y sin entrega: no vale la pena conservarla. */
export const isSnapshotEmpty = (s: OrderTabSnapshot | null): boolean =>
  !s || (s.cart.items.length === 0 && !s.cart.customerId && !s.delivery);

const newTab = (seq: number): OrderTab => ({
  id: crypto.randomUUID(),
  seq,
  parked: null,
});

const initialTab = newTab(1);

export const usePosOrderTabs = create<OrderTabsStore>()((set, get) => ({
  tabs: [initialTab],
  activeId: initialTab.id,
  nextSeq: 2,

  openTab: (current) => {
    const state = get();
    if (isSnapshotEmpty(current)) return false;
    const tab = newTab(state.nextSeq);
    set({
      tabs: [
        ...state.tabs.map((t) =>
          t.id === state.activeId ? { ...t, parked: current } : t,
        ),
        tab,
      ],
      activeId: tab.id,
      nextSeq: state.nextSeq + 1,
    });
    return true;
  },

  switchTab: (targetId, current) => {
    const state = get();
    if (targetId === state.activeId) return undefined;
    const target = state.tabs.find((t) => t.id === targetId);
    if (!target) return undefined;
    const restore = target.parked;
    const tabs = state.tabs
      // La activa vacía se descarta al dejarla (siempre queda la destino).
      .filter((t) => t.id !== state.activeId || !isSnapshotEmpty(current))
      .map((t) => {
        if (t.id === state.activeId) return { ...t, parked: current };
        if (t.id === targetId) return { ...t, parked: null };
        return t;
      });
    set({ tabs, activeId: targetId });
    return restore;
  },

  closeTab: (id) => {
    const state = get();
    const idx = state.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return undefined;
    if (id !== state.activeId) {
      set({ tabs: state.tabs.filter((t) => t.id !== id) });
      return undefined;
    }
    const remaining = state.tabs.filter((t) => t.id !== id);
    if (remaining.length === 0) {
      // Única pestaña: "cerrarla" = dejarla vacía (conserva su número).
      set({ tabs: [{ ...state.tabs[idx], parked: null }] });
      return null;
    }
    // Pasa a la vecina de la izquierda (o la primera si cerró la primera).
    const next = remaining[Math.max(0, idx - 1)];
    set({
      tabs: remaining.map((t) =>
        t.id === next.id ? { ...t, parked: null } : t,
      ),
      activeId: next.id,
    });
    return next.parked;
  },

  reset: () => {
    const tab = newTab(1);
    set({ tabs: [tab], activeId: tab.id, nextSeq: 2 });
  },
}));
