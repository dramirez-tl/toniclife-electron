// staffApi.ts — Autenticación del MODO STAFF (call center / corporativo).
// El login usa /auth/login del API (misma cuenta del admin web); la
// autorización real la decide el server: GET /pos/staff/branches responde 403
// si el rol del usuario no está permitido para operar el POS.

import axios from 'axios';
import { api, onStaffTokenExpired } from './api';
import { useStaffSession, type StaffBranch, type StaffUser } from '@/stores/staff-session.store';

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
    fullName?: string;
    role?: { code?: string } | string;
    /** El API de auth regresa los CODIGOS de rol aqui (ej. ['operaciones']);
     *  `role` no existe en la respuesta real — se conserva por compatibilidad. */
    roles?: string[];
  };
}

export class StaffLoginError extends Error {
  constructor(
    message: string,
    /** 'credentials' = usuario/contraseña; 'forbidden' = cuenta sin acceso al
     *  modo staff; 'network' = sin conexión / server caído. */
    public kind: 'credentials' | 'forbidden' | 'network',
  ) {
    super(message);
  }
}

/** Resultado del login de staff. La sesión NO se arranca aquí: el MODAL la
 *  arranca con staff.start() SOLO si el flujo sigue vivo — si el operador
 *  cerró el modal con el login en vuelo, esta promesa tardía no debe dejar
 *  un token staff invisible operando la terminal. */
export interface StaffAuthResult {
  user: StaffUser;
  tokens: { accessToken: string; refreshToken: string };
  branches: StaffBranch[];
}

/** Autentica y valida acceso al POS (vía staff/branches). NO toca el store. */
export async function staffAuthenticate(
  identifier: string,
  password: string,
): Promise<StaffAuthResult> {
  let login: LoginResponse;
  try {
    const { data } = await api.post<LoginResponse>('/auth/login', {
      identifier,
      password,
    });
    login = data;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response) {
      const msg =
        (err.response.data as { message?: string })?.message ??
        'Usuario o contraseña incorrectos';
      throw new StaffLoginError(msg, 'credentials');
    }
    throw new StaffLoginError('Sin conexión con el servidor', 'network');
  }

  // Autorización: la decide el server. 403 aquí = el rol no puede operar POS.
  let branches: StaffBranch[];
  try {
    const { data } = await api.get<StaffBranch[]>('/pos/staff/branches', {
      headers: { Authorization: `Bearer ${login.accessToken}` },
    });
    branches = data;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 403) {
      throw new StaffLoginError(
        'Tu cuenta no tiene acceso al modo staff del POS.',
        'forbidden',
      );
    }
    throw new StaffLoginError('Sin conexión con el servidor', 'network');
  }
  if (branches.length === 0) {
    throw new StaffLoginError(
      'Tu cuenta no tiene sucursales asignadas para operar.',
      'forbidden',
    );
  }

  const u = login.user;
  const roleCode =
    (typeof u.role === 'string' ? u.role : u.role?.code) ??
    (Array.isArray(u.roles) ? u.roles[0] : undefined);
  const user: StaffUser = {
    id: u.id,
    email: u.email,
    fullName:
      u.fullName ??
      `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() ??
      u.email,
    roleCode,
  };
  return {
    user,
    tokens: {
      accessToken: login.accessToken,
      refreshToken: login.refreshToken,
    },
    branches,
  };
}

/** Refresh del JWT de staff (registrado en api.ts para el retry de 401).
 *  true = tokens rotados; false = sesión staff cerrada.
 *  SINGLE-FLIGHT: N peticiones con 401 simultáneo comparten UN refresh, y el
 *  estado del store se re-lee DESPUÉS del await — si la sesión se cerró
 *  mientras el refresh volaba (logout/inactividad), no se resucita nada. */
let refreshInFlight: Promise<boolean> | null = null;

async function tryRefreshStaffToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = doRefreshStaffToken().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function doRefreshStaffToken(): Promise<boolean> {
  const { refreshToken } = useStaffSession.getState();
  if (!refreshToken) return false;
  try {
    const { data } = await api.post<LoginResponse>('/auth/refresh', {
      refreshToken,
    });
    const st = useStaffSession.getState();
    if (!st.user) return false; // sesión cerrada durante el refresh
    st.setTokens(data.accessToken, data.refreshToken ?? refreshToken);
    return true;
  } catch {
    const st = useStaffSession.getState();
    if (st.user) st.end();
    return false;
  }
}

// Registrar el handler una sola vez al importar el módulo.
onStaffTokenExpired(tryRefreshStaffToken);

export function staffLogout(): void {
  useStaffSession.getState().end();
}
