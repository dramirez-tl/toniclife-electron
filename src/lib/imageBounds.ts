// imageBounds.ts - Caja del contenido VISIBLE de un bitmap con transparencia.
//
// Los PNG del logo vienen en un lienzo cuadrado con mucho margen transparente
// (logo-text-dark.png: 1280×1280 con el texto en una franja de 1044×212). Para
// ponerlo en una hoja (cotización) hay que recortarlo a lo que se ve; si no,
// el logo sale diminuto. Puro: recibe los bytes, no toca Electron.

export interface PixelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Caja mínima que contiene todos los pixeles con alfa > `alphaThreshold`.
 * `pixels` son 4 bytes por pixel con el alfa en el cuarto (BGRA o RGBA), de
 * arriba hacia abajo. Devuelve null si el bitmap no cuadra con el tamaño o si
 * todo es transparente.
 */
export function visibleBounds(
  pixels: Uint8Array,
  width: number,
  height: number,
  alphaThreshold = 8,
): PixelBounds | null {
  if (width <= 0 || height <= 0 || pixels.length < width * height * 4) return null;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (pixels[row + x * 4 + 3] <= alphaThreshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
