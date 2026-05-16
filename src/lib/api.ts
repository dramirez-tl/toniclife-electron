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

const baseURL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api/v1';

let deviceToken: string | null = null;
let onUnauthorized: ((reason: string) => void) | null = null;

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
    if (deviceToken) {
      config.headers.Authorization = `Bearer ${deviceToken}`;
    }
    config.headers['X-App-Version'] = APP_VERSION;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      const body = error.response.data as { message?: string } | undefined;
      const reason = body?.message ?? 'Token rechazado por el servidor';
      // Log detallado para diagnostico desde DevTools.
      console.warn(
        '[POS API] 401 en',
        error.config?.url,
        '— motivo:',
        reason,
        '— body completo:',
        error.response.data,
      );
      onUnauthorized?.(reason);
    }
    return Promise.reject(error);
  },
);
