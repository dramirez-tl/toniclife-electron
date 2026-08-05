import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import electron from 'vite-plugin-electron/simple';
import path from 'node:path';
import { readFileSync } from 'node:fs';

// Versión real desde package.json, inyectada en build-time (ver lib/version.ts).
const pkg = JSON.parse(
  readFileSync(path.join(__dirname, 'package.json'), 'utf8'),
) as { version: string };

// npm run release = paquete OFICIAL para sucursales: fuerza APP_ENV=production
// aunque el .env.local del equipo que compila diga development/staging (evita
// publicar por accidente un build con diagnósticos visibles).
const isRelease = process.env.npm_lifecycle_event === 'release';

// Content-Security-Policy del renderer (dictamen 2.2.1). Solo en BUILDS: el
// dev server de Vite necesita inline scripts (preamble de react-refresh) y
// eval para HMR; y file:// no emite headers, así que la vía es un meta tag
// inyectado al empaquetar. connect-src exige https/wss (bloquea API en claro,
// espejo del guard de api.ts); img-src permite https (imágenes de producto
// servidas por el API/GCS) y data: (previews locales).
const CSP_CONTENT = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

const cspPlugin = {
  name: 'inject-csp-meta',
  transformIndexHtml: {
    order: 'post' as const,
    handler(html: string, ctx: { server?: unknown }) {
      if (ctx?.server) return html; // dev server: sin CSP (HMR la necesita laxa)
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP_CONTENT}">`,
      );
    },
  },
};

export default defineConfig({
  // Rutas RELATIVAS en el bundle: la app empaquetada carga dist/index.html con
  // file:// y las rutas absolutas (/assets/...) romperían fuera del dev server.
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    ...(isRelease
      ? { 'import.meta.env.VITE_APP_ENV': JSON.stringify('production') }
      : {}),
  },
  plugins: [
    react(),
    tailwindcss(),
    cspPlugin,
    electron({
      main: {
        entry: 'electron/main.ts',
        // Al recompilar el main (cualquier cambio en electron/*.ts excepto el
        // preload), matamos el proceso Electron actual y lo relanzamos. Es el
        // equivalente a nodemon para el main process.
        onstart({ startup }) {
          startup();
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              // iconv-lite carga tablas de encoding via require dinamico;
              // bundlearlo puede romper en runtime. Lo dejamos en node_modules
              // y Node lo carga normal al iniciar el main process.
              // electron-updater igual (CJS con requires dinamicos); va en
              // dependencies para que electron-builder lo empaquete en el asar.
              external: ['electron', 'iconv-lite', 'electron-updater'],
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
        // Al recompilar el preload, recargamos el renderer (no hace falta
        // reiniciar Electron entero; solo el WebContents).
        onstart({ reload }) {
          reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
              // Forzamos format=cjs + extension=.cjs para que Node lo trate como
              // CommonJS sin importar el "type": "module" del package.json.
              // Si el archivo termina en .mjs pero el contenido es CJS (require),
              // Electron falla silenciosamente al cargar el preload y
              // window.toniclife queda undefined en el renderer.
              output: {
                format: 'cjs',
                entryFileNames: '[name].cjs',
                inlineDynamicImports: true,
              },
            },
          },
        },
      },
      renderer: {},
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5179,
    strictPort: true,
  },
});
