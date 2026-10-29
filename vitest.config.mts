import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Pruebas unitarias de lógica PURA del POS (sin DOM ni Electron): `npm test`.
// Alcance inicial: stores/pos-cart.store (totales, cupón y descuento global).
// Config aparte de vite.config.ts: el plugin de Electron no aplica en pruebas.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
