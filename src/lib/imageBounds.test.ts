import { describe, expect, it } from 'vitest';
import { visibleBounds } from './imageBounds';

/** Bitmap transparente de w×h con los pixeles `opaque` ([x, y]) visibles. */
function bitmap(w: number, h: number, opaque: Array<[number, number]>, alpha = 255): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (const [x, y] of opaque) px[(y * w + x) * 4 + 3] = alpha;
  return px;
}

describe('visibleBounds', () => {
  it('recorta al contenido visible dentro de un lienzo con margen', () => {
    const px = bitmap(10, 8, [
      [3, 2],
      [6, 2],
      [4, 5],
    ]);
    expect(visibleBounds(px, 10, 8)).toEqual({ x: 3, y: 2, width: 4, height: 4 });
  });

  it('un solo pixel visible da una caja de 1×1', () => {
    expect(visibleBounds(bitmap(5, 5, [[4, 0]]), 5, 5)).toEqual({ x: 4, y: 0, width: 1, height: 1 });
  });

  it('una imagen sin margen se queda completa', () => {
    const px = bitmap(3, 2, [
      [0, 0],
      [2, 1],
    ]);
    expect(visibleBounds(px, 3, 2)).toEqual({ x: 0, y: 0, width: 3, height: 2 });
  });

  it('ignora el alfa casi transparente (orillas suavizadas)', () => {
    const px = bitmap(6, 6, [[1, 1]], 5);
    px[(3 * 6 + 3) * 4 + 3] = 200;
    expect(visibleBounds(px, 6, 6)).toEqual({ x: 3, y: 3, width: 1, height: 1 });
  });

  it('todo transparente: null', () => {
    expect(visibleBounds(bitmap(4, 4, []), 4, 4)).toBeNull();
  });

  it('bitmap que no cuadra con el tamaño: null', () => {
    expect(visibleBounds(new Uint8Array(10), 4, 4)).toBeNull();
    expect(visibleBounds(new Uint8Array(0), 0, 0)).toBeNull();
  });
});
