// logo.ts - Convierte un PNG del logo Tonic Life a bytes ESC/POS (GS v 0)
// para imprimir como bitmap monocromatico en el encabezado del ticket.
//
// Estrategia:
//   1) Cargar PNG via Electron nativeImage (sin dependencias nativas).
//   2) Redimensionar al ancho deseado en dots (puntos de impresion).
//   3) Convertir BGRA -> luminancia -> umbral (threshold) a 1-bit.
//      Pixeles oscuros => bit 1 (imprime negro).
//      Pixeles claros / transparentes => bit 0 (papel blanco).
//   4) Empaquetar 8 pixeles por byte, MSB primero (formato ESC/POS).
//   5) Anteponer comando GS v 0 con dimensiones.

import { nativeImage, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Busca el PNG del logo en las rutas posibles (dev / produccion empaquetada).
 * Retorna la primera ruta que existe, o null si no encuentra.
 */
function findLogoPath(filename: string): string | null {
  const candidates = [
    // Dev: vite-plugin-electron compila a dist-electron/, public/ esta al lado.
    path.join(__dirname, '..', 'public', 'images', 'logo', 'png', filename),
    // Prod empaquetado: public/ se copia a dist/ y a app.getAppPath()/dist/.
    path.join(app.getAppPath(), 'dist', 'images', 'logo', 'png', filename),
    path.join(app.getAppPath(), 'public', 'images', 'logo', 'png', filename),
    // Fallback: relativo al cwd (al ejecutar npm run dev desde el root).
    path.join(process.cwd(), 'public', 'images', 'logo', 'png', filename),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Construye los bytes ESC/POS GS v 0 para imprimir un logo.
 *
 * @param widthDots Ancho objetivo en puntos. Debe ser multiplo de 8 para
 *                  no desperdiciar bytes. 80mm = 576 dots de cabezal; valores
 *                  tipicos: 200 (centrado, pequeno) o 320 (grande).
 * @param filename  Archivo PNG dentro de public/images/logo/png/.
 * @param threshold Brillo (0-255) bajo el cual un pixel se considera "negro".
 *                  Default 160 para que el logo dark-filled imprima solido.
 * @returns Buffer con bytes ESC/POS listos para mandar al spooler, o null si
 *          no se pudo cargar/procesar el logo (no abortar la impresion).
 */
export function buildLogoBitmapBytes(
  widthDots = 200,
  filename = 'logo-circle-dark-filled.png',
  threshold = 160,
): Buffer | null {
  const logoPath = findLogoPath(filename);
  if (!logoPath) {
    console.warn(`[logo] PNG no encontrado: ${filename}`);
    return null;
  }

  try {
    const img = nativeImage.createFromPath(logoPath);
    if (img.isEmpty()) {
      console.warn(`[logo] PNG vacio o ilegible: ${logoPath}`);
      return null;
    }

    // Alinear ancho a multiplo de 8 (cada byte = 8 pixeles).
    const targetWidth = Math.max(8, Math.round(widthDots / 8) * 8);
    const origSize = img.getSize();
    const aspectRatio = origSize.height / origSize.width;
    const targetHeight = Math.round(targetWidth * aspectRatio);

    const resized = img.resize({
      width: targetWidth,
      height: targetHeight,
      quality: 'best',
    });

    // toBitmap() retorna BGRA top-to-bottom (Chromium convention).
    const bgra = resized.toBitmap();
    const { width, height } = resized.getSize();

    const widthBytes = width / 8;
    const monoBytes = Buffer.alloc(widthBytes * height, 0);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const b = bgra[idx];
        const g = bgra[idx + 1];
        const r = bgra[idx + 2];
        const a = bgra[idx + 3];

        // Pixel transparente -> tratar como blanco (no imprimir).
        if (a < 128) continue;

        // Luminancia perceptual (Rec. 709 simplificada).
        const luma = (r * 30 + g * 59 + b * 11) / 100;

        if (luma < threshold) {
          // Pixel oscuro -> bit 1 (imprimir negro).
          const byteIdx = y * widthBytes + (x >> 3);
          const bitIdx = 7 - (x & 7);
          monoBytes[byteIdx] |= 1 << bitIdx;
        }
      }
    }

    const xL = widthBytes & 0xff;
    const xH = (widthBytes >> 8) & 0xff;
    const yL = height & 0xff;
    const yH = (height >> 8) & 0xff;

    // GS v 0 m xL xH yL yH d1...dn  (m=0 = normal, sin doble densidad)
    return Buffer.concat([
      Buffer.from([0x1d, 0x76, 0x30, 0x00, xL, xH, yL, yH]),
      monoBytes,
    ]);
  } catch (err) {
    console.warn(
      `[logo] Error procesando ${logoPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}
