// api.ts - Cliente HTTP del POS Electron contra toniclife-api.
//
// Diferencias vs el cliente del admin web:
//   - El token es deviceToken (long-lived), NO accessToken de usuario.
//   - No hay flujo de refresh; si la API devuelve 401 el token es invalido y
//     la terminal vuelve a la pantalla de activacion.
//   - No hay cookies; todo va por Bearer header.
//   - Cada request envia X-App-Version para auditoria en pos_licenses.
//
// 403 NO invalida sesion automaticamente porque podria venir de otros endpoints
// del POS (permisos por sucursal, etc.). Los call sites que validan licencia
// (validate/heartbeat) interpretan 403 explicitamente.

import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { APP_VERSION } from './version';
import { APP_ENV } from './env';

const baseURL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api/v1';

// Dictamen 2.2.2: un build de PRODUCCIÓN jamás debe hablar HTTP plano con el
// backend (device token y datos de venta viajarían en claro). El guard cubre
// también el socket y la sonda de conexión: derivan de la misma variable.
if (APP_ENV === 'production' && !baseURL.startsWith('https://')) {
  throw new Error(
    `Configuración insegura: VITE_API_URL debe ser https:// en producción (recibido: ${baseURL}). ` +
      'Corrige la variable de build y vuelve a empaquetar.',
  );
}

let deviceToken: string | null = null;
let onUnauthorized: ((reason: string) => void) | null = null;

// MODO STAFF (call center / corporativo con SU cuenta encima de la terminal):
// cuando hay staffToken, las peticiones de NEGOCIO viajan con el JWT del
// usuario (el API deja seller_id = la persona real). Los endpoints de
// LICENCIA (/pos-licenses/*) siguen SIEMPRE con el device token — identifican
// a la terminal física (heartbeat, gate, updates) sin importar quién opere.
// Los de /auth/* van sin token de sesión (login/refresh son públicos).
let staffToken: string | null = null;
let onStaffUnauthorized: (() => Promise<boolean>) | null = null;

export function setStaffToken(token: string | null): void {
  staffToken = token;
}

/** Handler que intenta refrescar el JWT de staff; regresa true si lo logró
 *  (la petición original se reintenta) o false (la sesión staff se cierra). */
export function onStaffTokenExpired(
  handler: (() => Promise<boolean>) | null,
): void {
  onStaffUnauthorized = handler;
}

function isLicenseUrl(url: string): boolean {
  return url.includes('/pos-licenses/');
}
function isAuthUrl(url: string): boolean {
  return url.includes('/auth/');
}

export function setDeviceToken(token: string | null): void {
  deviceToken = token;
}

export function onApiUnauthorized(handler: (reason: string) => void): void {
  onUnauthorized = handler;
}

export const api: AxiosInstance = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 20_000,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (config.headers) {
    const url = config.url ?? '';
    if (config.headers.Authorization) {
      // Un call site que puso su propio Bearer (ej. staffApi validando el
      // token recién emitido ANTES de arrancar la sesión) se respeta.
    } else if (isAuthUrl(url)) {
      // login/refresh: sin Bearer (públicos).
    } else if (staffToken && !isLicenseUrl(url)) {
      config.headers.Authorization = `Bearer ${staffToken}`;
    } else if (deviceToken) {
      config.headers.Authorization = `Bearer ${deviceToken}`;
    }
    config.headers['X-App-Version'] = APP_VERSION;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (error.response?.status === 401) {
      const body = error.response.data as { message?: string } | undefined;
      const reason = body?.message ?? 'Token rechazado por el servidor';
      const url = error.config?.url ?? '';
      // Log detallado para diagnostico desde DevTools.
      console.warn(
        '[POS API] 401 en',
        url,
        '— motivo:',
        reason,
        '— body completo:',
        error.response.data,
      );

      // MODO STAFF: un 401 en un endpoint de negocio con JWT de staff intenta
      // UN refresh; si funciona, reintenta la petición original. Si no, el
      // handler cierra la sesión staff y la terminal sigue con device token.
      const cfg = error.config as
        | (InternalAxiosRequestConfig & { _staffRetry?: boolean })
        | undefined;
      if (
        staffToken &&
        cfg &&
        !cfg._staffRetry &&
        !isLicenseUrl(url) &&
        !isAuthUrl(url) &&
        onStaffUnauthorized
      ) {
        const refreshed = await onStaffUnauthorized();
        // OJO: cfg.headers conserva el Authorization YA procesado del primer
        // intento (el JWT vencido). Hay que reinstalar el token fresco o el
        // reintento repetiría el 401 para siempre.
        if (refreshed && staffToken) {
          cfg._staffRetry = true;
          cfg.headers.Authorization = `Bearer ${staffToken}`;
          return api.request(cfg);
        }
        return Promise.reject(error);
      }

      // Solo invalidamos la SESIÓN cuando el 401 viene de un endpoint de
      // LICENCIA (validación del device token). Un 401 de un endpoint de
      // negocio (ej. uno que no acepta el token de terminal) NO debe cerrar
      // la terminal: dejamos que esa petición falle y seguimos operando. Si el
      // token realmente está revocado, /pos-licenses/me o /heartbeat lo
      // detectarán y entonces sí se invalida.
      if (url.includes('/pos-licenses/')) {
        onUnauthorized?.(reason);
      }
    }
    return Promise.reject(error);
  },
);
