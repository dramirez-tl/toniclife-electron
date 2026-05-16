import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import electron from 'vite-plugin-electron/simple';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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
              external: ['electron', 'iconv-lite'],
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
