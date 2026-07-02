// env.ts - Entorno de la app (development | staging | production).
//
// Se controla con VITE_APP_ENV en build-time. Default SEGURO: si la variable
// no está definida, un build de producción (vite build) se asume 'production'
// y el dev server 'development' — así un paquete para sucursales nunca muestra
// diagnósticos por accidente; para un build de staging se declara explícito
// VITE_APP_ENV=staging.

export type AppEnv = 'development' | 'staging' | 'production';

function resolveAppEnv(): AppEnv {
  const raw = (import.meta.env.VITE_APP_ENV ?? '').toString().toLowerCase();
  if (raw === 'development' || raw === 'staging' || raw === 'production') {
    return raw;
  }
  return import.meta.env.PROD ? 'production' : 'development';
}

export const APP_ENV: AppEnv = resolveAppEnv();

/** Bloques de diagnóstico (rutas locales, etc.): solo fuera de producción. */
export const SHOW_DIAGNOSTICS = APP_ENV !== 'production';
