// staff-session.store.ts — Sesión de STAFF encima de la terminal (modo call
// center / corporativo). Se abre con el login oculto (clic al logo del POS):
// la persona entra con SU cuenta y elige la sucursal a operar; las
// operaciones de negocio viajan con su JWT + branchId (el API deja la venta
// con seller_id = la persona real → trazabilidad).
//
// SOLO EN MEMORIA: nunca se persiste a disco de la terminal. Al cerrar la
// app, cerrar sesión o expirar por inactividad, se pierde.

import { create } from 'zustand';
import { setStaffToken } from '@/lib/api';

/** Sucursal operable en modo staff (shape de GET /pos/staff/branches —
 *  espejo de StoredSession.branch para que PosScreen no distinga origen). */
export interface StaffBranch {
  id: string;
  code: string;
  name: string;
  timezone?: string;
  currencyCode?: string;
  ticketName?: string;
  legacyKey?: string;
  isCedea?: boolean;
  country?: { code: string; name: string };
}

export interface StaffUser {
  id: string;
  email: string;
  fullName: string;
  roleCode?: string;
}

/** Cierre automático por inactividad (ventas en curso incluidas — la persona
 *  puede volver a entrar; el carrito no se toca al expirar). */
export const STAFF_IDLE_TIMEOUT_MS = 15 * 60_000;

interface StaffSessionState {
  user: StaffUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  branches: StaffBranch[];
  selectedBranch: StaffBranch | null;
  /** Último movimiento del operador (para el timeout de inactividad). */
  lastActivityAt: number;

  /** true cuando hay usuario Y sucursal elegida (el POS opera re-scopeado). */
  isActive: () => boolean;
  start: (
    user: StaffUser,
    tokens: { accessToken: string; refreshToken: string },
    branches: StaffBranch[],
  ) => void;
  selectBranch: (branch: StaffBranch | null) => void;
  /** Rota tokens tras un refresh exitoso. */
  setTokens: (accessToken: string, refreshToken: string) => void;
  touch: () => void;
  end: () => void;
}

export const useStaffSession = create<StaffSessionState>((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  branches: [],
  selectedBranch: null,
  lastActivityAt: Date.now(),

  isActive: () => !!get().user && !!get().selectedBranch,

  start: (user, tokens, branches) => {
    setStaffToken(tokens.accessToken);
    set({
      user,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      branches,
      selectedBranch: null,
      lastActivityAt: Date.now(),
    });
  },

  selectBranch: (branch) =>
    set({ selectedBranch: branch, lastActivityAt: Date.now() }),

  setTokens: (accessToken, refreshToken) => {
    // Si la sesión ya se cerró (logout/inactividad/terminal invalidada), un
    // refresh que resolvió tarde NO debe resucitar el token fantasma.
    if (!get().user) return;
    setStaffToken(accessToken);
    set({ accessToken, refreshToken });
  },

  touch: () => set({ lastActivityAt: Date.now() }),

  end: () => {
    setStaffToken(null);
    set({
      user: null,
      accessToken: null,
      refreshToken: null,
      branches: [],
      selectedBranch: null,
    });
  },
}));
