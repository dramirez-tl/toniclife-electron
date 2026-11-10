// quote.test.ts - COTIZACIÓN desde el carrito (10-nov-2026): el carrito se
// convierte en una hoja completa (nombres enteros, contenido de kits,
// promociones, regalos, totales y puntos) para mandarla por correo.

import { describe, expect, it } from 'vitest';
import { buildQuotePayload, type QuoteContext } from './quote';
import {
  QUOTE_LEGEND,
  buildQuoteHtml,
  quoteDateLabel,
  quoteFileBase,
  type QuotePayload,
} from './quoteHtml';
import type { PosCart, PosCartItem } from '@/types/pos';

const CTX: QuoteContext = {
  // 10-nov-2026 13:45 en el centro de México.
  createdAt: '2026-11-10T19:45:00.000Z',
  timezone: 'America/Mexico_City',
  branchName: 'CEDEA Irapuato',
  attendedBy: 'Lucina Rodríguez',
  currencySymbol: '$',
  currencyCode: 'MXN',
};

const item = (over: Partial<PosCartItem>): PosCartItem => ({
  productId: 'p-1',
  productSku: '8012',
  productName: 'TONIC LIFE',
  quantity: 1,
  unitPrice: 582,
  taxRate: 0.16,
  taxAmount: 80.28,
  isIncludedInPrice: true,
  subtotal: 501.72,
  total: 582,
  points: 502,
  businessVolume: 502,
  ...over,
});

const LONG_NAME =
  'JIMMY COFFEE FRASCO 270 G CAFÉ SOLUBLE CON GANODERMA, GINSENG Y CORDYCEPS EDICIÓN ESPECIAL';

function cart(over: Partial<PosCart> = {}): PosCart {
  const items = [
    item({}),
    item({
      productId: 'p-2',
      productSku: '9019',
      productName: LONG_NAME,
      quantity: 3,
      unitPrice: 391,
      taxRate: 0,
      taxAmount: 0,
      subtotal: 1173,
      total: 1173,
      points: 1011,
    }),
  ];
  return {
    items,
    customerId: 'c-1',
    customerName: 'ROSA CHAMBOYA MACIEL',
    customerNumber: '1786663',
    subtotal: 1674.72,
    taxAmount: 80.28,
    total: 1755,
    totalPoints: 1513,
    totalBusinessVolume: 1513,
    requiresInvoice: false,
    membershipCampaignId: null,
    applyMembership: true,
    membershipSelectedId: null,
    ...over,
  };
}

describe('buildQuotePayload', () => {
  it('lleva TODOS los productos con el nombre entero, clave, cantidad, precio e importe', () => {
    const q = buildQuotePayload(cart(), CTX);
    expect(q.items).toEqual([
      { sku: '8012', name: 'TONIC LIFE', quantity: 1, unitPrice: 582, total: 582, notes: [] },
      { sku: '9019', name: LONG_NAME, quantity: 3, unitPrice: 391, total: 1173, notes: [] },
    ]);
    expect(q).toMatchObject({
      branchName: 'CEDEA Irapuato',
      attendedBy: 'Lucina Rodríguez',
      customerName: 'ROSA CHAMBOYA MACIEL',
      customerNumber: '1786663',
      totalPoints: 1513,
      currencyCode: 'MXN',
    });
  });

  it('los totales son los mismos del carrito (Subtotal / Impuestos / Total)', () => {
    const q = buildQuotePayload(cart(), CTX);
    expect(q.totals.map((r) => [r.kind, r.amount])).toEqual([
      ['subtotal', 1674.72],
      ['tax', 80.28],
      ['total', 1755],
    ]);
  });

  it('con cupón: Subtotal bruto, cupón, Total e IVA incluido, como el ticket', () => {
    const q = buildQuotePayload(
      cart({
        couponCode: 'BIENVENIDA10',
        couponDiscount: 175.5,
        couponDescription: '10 % de bienvenida',
        subtotal: 1507.25,
        taxAmount: 72.25,
        total: 1579.5,
      }),
      CTX,
    );
    expect(q.totals.map((r) => r.kind)).toEqual(['subtotal', 'discount', 'total', 'taxIncluded']);
    expect(q.totals[0].amount).toBe(1755);
    expect(q.totals[1]).toMatchObject({ amount: -175.5, code: 'BIENVENIDA10' });
    expect(q.couponDescription).toBe('10 % de bienvenida');
  });

  it('precio público: sin distribuidor no hay nombre, número ni puntos', () => {
    const q = buildQuotePayload(
      cart({ customerId: undefined, customerName: undefined, customerNumber: undefined }),
      { ...CTX, attendedBy: undefined },
    );
    expect(q.customerName).toBeUndefined();
    expect(q.customerNumber).toBeUndefined();
    expect(q.totalPoints).toBe(0);
    expect(q.attendedBy).toBeUndefined();
  });

  it('kit: el contenido va COMPLETO (el carrito lo recorta); promoción y boletos bajo el renglón', () => {
    const components = Array.from({ length: 8 }, (_, i) => ({
      name: `PRODUCTO DE NOMBRE LARGO ${i + 1}`,
      quantity: 1,
    }));
    const q = buildQuotePayload(
      cart({
        items: [
          item({
            productSku: 'KPM14',
            productName: 'Kit Tonic Center Premium',
            productType: 'kit',
            components,
            promo: {
              promotionId: 'pr-1',
              code: 'BUENFIN2026-KIT',
              name: 'Kit Tonic Center Premium a $2,000',
              type: 'fixed_price',
              typeLabel: 'Precio especial',
              freeQuantity: 0,
              discountAmount: 789,
              points: 3300,
              businessValue: 0,
              kitBonusExcluded: true,
            },
          }),
          item({
            productId: 'p-3',
            productSku: 'EP9019',
            productName: 'Expansión Puebla',
            quantity: 2,
            event: {
              id: 'e-1',
              code: 'EXP-PUE',
              name: 'Expansión Puebla',
              eventDate: '2026-11-21',
              status: 'active',
              label: 'Titular',
              ticketsPerUnit: 1,
            },
          }),
        ],
      }),
      CTX,
    );
    const [kit, ticket] = q.items;
    expect(kit.notes[0]).toMatch(/^Incluye: 1 x PRODUCTO DE NOMBRE LARGO 1, /);
    expect(kit.notes[0]).toContain('PRODUCTO DE NOMBRE LARGO 8');
    expect(kit.notes[0]).not.toContain('…');
    expect(kit.notes[1]).toBe(
      'Kit Tonic Center Premium a $2,000: Precio especial: -$789.00 · sin bono de inscripción',
    );
    expect(ticket.notes).toHaveLength(1);
    expect(ticket.notes[0]).toContain('Expansión Puebla');
    expect(ticket.notes[0]).toContain('2 boleto(s)');
  });

  it('regalos y ahorro de temporada', () => {
    const q = buildQuotePayload(
      cart({
        seasonalDiscount: 391,
        seasonalGifts: [
          {
            productId: 'g-1',
            sku: '9019',
            name: 'JIMMY COFFEE FRASCO',
            quantity: 1,
            promotionId: 'pr-2',
            promoCode: 'BF-5MAS1',
            promoName: 'Compra 5 y llévate 1',
          },
        ],
      }),
      CTX,
    );
    expect(q.gifts).toEqual([
      { sku: '9019', name: 'JIMMY COFFEE FRASCO', quantity: 1, promoName: 'Compra 5 y llévate 1' },
    ]);
    expect(q.seasonalDiscount).toBe(391);
  });
});

describe('quoteDateLabel / quoteFileBase', () => {
  it('la fecha sale en la hora de la sucursal', () => {
    expect(quoteDateLabel('2026-11-10T19:45:00.000Z', 'America/Mexico_City')).toBe(
      '10 de noviembre de 2026, 13:45',
    );
    // Tijuana va dos horas atrás; después de medianoche UTC cambia el día.
    expect(quoteDateLabel('2026-11-10T19:45:00.000Z', 'America/Tijuana')).toBe(
      '10 de noviembre de 2026, 11:45',
    );
    expect(quoteDateLabel('2026-11-11T05:30:00.000Z', 'America/Mexico_City')).toBe(
      '10 de noviembre de 2026, 23:30',
    );
  });

  it('zona inválida o fecha inválida no truenan', () => {
    expect(quoteDateLabel('2026-11-10T19:45:00.000Z', 'No/Existe')).toContain('2026');
    expect(quoteDateLabel('nada')).toBe('');
  });

  it('nombre de archivo con el número del distribuidor o "publico"', () => {
    const q = buildQuotePayload(cart(), CTX);
    expect(quoteFileBase(q)).toMatch(/^cotizacion-1786663-\d{8}-\d{4}$/);
    expect(quoteFileBase({ ...q, customerNumber: undefined })).toMatch(
      /^cotizacion-publico-\d{8}-\d{4}$/,
    );
    expect(quoteFileBase({ ...q, customerNumber: '17/86 663' })).toMatch(/^cotizacion-1786663-/);
  });
});

describe('buildQuoteHtml', () => {
  const html = (over: Partial<QuotePayload> = {}, logo?: string | null) =>
    buildQuoteHtml({ ...buildQuotePayload(cart(), CTX), ...over }, { logoDataUrl: logo });

  it('la hoja trae cada producto completo, los totales, los puntos y la leyenda', () => {
    const h = html();
    expect(h).toContain('COTIZACIÓN');
    expect(h).toContain(LONG_NAME);
    expect(h).toContain('>8012<');
    expect(h).toContain('>9019<');
    expect(h).toContain('$1,173.00');
    expect(h).toContain('$1,755.00');
    expect(h).toContain('MXN');
    expect(h).toContain('ROSA CHAMBOYA MACIEL');
    expect(h).toContain('No. 1786663');
    expect(h).toContain('CEDEA Irapuato');
    expect(h).toContain('Lucina Rodríguez');
    expect(h).toContain('1,513.00 pts');
    expect(h).toContain('2 productos · 4 piezas');
    expect(h).toContain(QUOTE_LEGEND);
    expect(h).toMatch(/13:45/);
  });

  it('es autocontenida: sin scripts ni recursos externos; el logo va incrustado', () => {
    const h = html({}, 'data:image/png;base64,AAAA');
    expect(h).not.toMatch(/<script/i);
    expect(h).not.toMatch(/https?:\/\//i);
    expect(h).toContain('src="data:image/png;base64,AAAA"');
    // Sin logo cae al nombre en texto.
    expect(html({}, null)).toContain('TONIC LIFE</div>');
  });

  it('escapa lo que venga en nombres y notas', () => {
    const h = html({
      customerName: 'ANA <b>"GÓMEZ"</b> & CÍA',
      items: [
        {
          sku: 'X<1>',
          name: 'Té <script>alert(1)</script>',
          quantity: 1,
          unitPrice: 10,
          total: 10,
          notes: ['Incluye: 1 x "A" & B'],
        },
      ],
    });
    expect(h).not.toContain('<script>alert(1)</script>');
    expect(h).toContain('Té &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(h).toContain('ANA &lt;b&gt;&quot;GÓMEZ&quot;&lt;/b&gt; &amp; CÍA');
    expect(h).toContain('Incluye: 1 x &quot;A&quot; &amp; B');
    expect(h).toContain('1 producto · 1 pieza');
  });

  it('precio público, cupón, regalos y ahorro por promociones', () => {
    const h = html({
      customerName: undefined,
      customerNumber: undefined,
      totalPoints: 0,
      seasonalDiscount: 391,
      couponDescription: '10 % de bienvenida',
      gifts: [{ sku: '9019', name: 'JIMMY COFFEE', quantity: 1, promoName: 'Compra 5 y llévate 1' }],
      totals: [
        { kind: 'subtotal', label: 'Subtotal', amount: 1755 },
        { kind: 'discount', label: 'Cupón BIENVENIDA10', amount: -175.5, code: 'BIENVENIDA10' },
        { kind: 'total', label: 'TOTAL', amount: 1579.5 },
        { kind: 'taxIncluded', label: 'IVA incluido', amount: 72.25 },
      ],
    });
    expect(h).toContain('Precio público');
    expect(h).not.toContain('Puntos de la compra');
    expect(h).toContain('Cupón BIENVENIDA10');
    expect(h).toContain('- $175.50');
    expect(h).toContain('IVA incluido');
    expect(h).toContain('Regalo: Compra 5 y llévate 1');
    expect(h).toContain('Ahorro por promociones');
    expect(h).toContain('10 % de bienvenida');
  });
});
