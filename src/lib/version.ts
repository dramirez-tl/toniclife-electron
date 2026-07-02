// version.ts - Version del cliente Electron reportada a la API via X-App-Version
// y mostrada en el header del POS.
//
// Inyectada en build-time desde package.json (vite.config.ts → define). El
// fallback aplica solo si algún tooling evalúa este módulo fuera de Vite.

declare const __APP_VERSION__: string | undefined;

export const APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-dev';
