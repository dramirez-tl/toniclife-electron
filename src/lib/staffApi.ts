// staffApi.ts — Autenticación del MODO STAFF (call center / corporativo).
// El login usa /auth/login del API (misma cuenta del admin web) o Google
// (/auth/google/desktop: el navegador del SO entrega un código PKCE y el API
// lo cambia por la sesión); la autorización real la decide el server:
// GET /pos/staff/branches responde 403 si el rol del usuario no está
// permitido para operar el POS.

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
    /** Foto del expediente de RRHH (miniatura y original), firmadas. */
    avatarUrl?: string | null;
    photoUrl?: string | null;
    departmentName?: string | null;
  };
}

export class StaffLoginError extends Error {
  constructor(
    message: string,
    /** 'credentials' = usuario/contraseña; 'forbidden' = cuenta sin acceso al
     *  modo staff; 'network' = sin conexión / server caído; 'cancelled' = el
     *  operador cerró la ventana de Google (no es un error para mostrar). */
    public kind: 'credentials' | 'forbidden' | 'network' | 'cancelled',
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

function apiMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err) && err.response) {
    return (err.response.data as { message?: string })?.message ?? fallback;
  }
  return fallback;
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
      throw new StaffLoginError(
        apiMessage(err, 'Usuario o contraseña incorrectos'),
        'credentials',
      );
    }
    throw new StaffLoginError('Sin conexión con el servidor', 'network');
  }
  return authorizeStaff(login);
}

/** Con la sesión del API ya creada: ¿puede operar el POS y en qué sucursales? */
async function authorizeStaff(login: LoginResponse): Promise<StaffAuthResult> {
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
    avatarUrl: u.avatarUrl ?? null,
    photoUrl: u.photoUrl ?? null,
    departmentName: u.departmentName ?? null,
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

// ---- Google Sign-In (modo staff) ----
// Google no permite iniciar sesión dentro de Electron: el main abre el
// navegador del SO (electron/google.ts) y regresa un código PKCE; el API lo
// cambia por la sesión con el secreto del cliente de escritorio. Si la cuenta
// de Google no está vinculada a ningún usuario, el API pide confirmar UNA vez
// con usuario + contraseña (/auth/google/link) y la deja vinculada.

export interface StaffGoogleStatus {
  enabled: boolean;
  webClientId: string | null;
  /** Client ID del cliente OAuth de escritorio; null = el POS no muestra el botón. */
  desktopClientId: string | null;
}

/** null = sin conexión o API sin Google: el modal no muestra el botón. */
export async function staffGoogleStatus(): Promise<StaffGoogleStatus | null> {
  try {
    const { data } = await api.get<StaffGoogleStatus>('/auth/google/status');
    return data;
  } catch {
    return null;
  }
}

interface GoogleLinkRequired {
  requiresAccountLink: true;
  linkTicket: string;
  email: string;
  name: string | null;
}

export type StaffGoogleAuth =
  | { kind: 'ok'; result: StaffAuthResult }
  | { kind: 'link'; linkTicket: string; email: string; name: string | null };

/** Abre Google en el navegador y entra; o pide vincular (kind 'link'). */
export async function staffAuthenticateGoogle(
  desktopClientId: string,
): Promise<StaffGoogleAuth> {
  const flow = await window.toniclife.google.signIn(desktopClientId);
  if (!flow.ok) {
    throw new StaffLoginError(flow.error, flow.cancelled ? 'cancelled' : 'credentials');
  }
  let data: LoginResponse | GoogleLinkRequired;
  try {
    const res = await api.post<LoginResponse | GoogleLinkRequired>(
      '/auth/google/desktop',
      {
        code: flow.code,
        codeVerifier: flow.codeVerifier,
        redirectUri: flow.redirectUri,
      },
    );
    data = res.data;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response) {
      throw new StaffLoginError(
        apiMessage(err, 'No se pudo iniciar sesión con Google'),
        'credentials',
      );
    }
    throw new StaffLoginError('Sin conexión con el servidor', 'network');
  }
  if ('requiresAccountLink' in data && data.requiresAccountLink) {
    return {
      kind: 'link',
      linkTicket: data.linkTicket,
      email: data.email,
      name: data.name,
    };
  }
  return { kind: 'ok', result: await authorizeStaff(data as LoginResponse) };
}

/** Confirma con usuario + contraseña, vincula la cuenta de Google y entra. */
export async function staffLinkGoogle(
  linkTicket: string,
  identifier: string,
  password: string,
): Promise<StaffAuthResult> {
  let login: LoginResponse;
  try {
    const { data } = await api.post<LoginResponse>('/auth/google/link', {
      linkTicket,
      identifier,
      password,
    });
    login = data;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response) {
      throw new StaffLoginError(
        apiMessage(err, 'Usuario o contraseña incorrectos'),
        'credentials',
      );
    }
    throw new StaffLoginError('Sin conexión con el servidor', 'network');
  }
  return authorizeStaff(login);
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
