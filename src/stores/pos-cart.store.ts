// stores/pos-cart.store.ts - Zustand store del carrito POS.
// Portado de toniclife-next/src/stores/pos-cart.store.ts. Desde el 29-oct-2026
// los totales siguen la regla del API (createSale / pos/lib/sale-discount.lib):
// el descuento global (cupón o manual) va SOBRE EL TOTAL CON IMPUESTO y se
// prorratea por renglón. El cálculo vive en `lib/saleDiscount.ts`, ESPEJO 1:1
// de la lib del API; ver `calculateCartTotals`.

import { create } from 'zustand';
import type {
  KitComponent,
  PosCart,
  PosCartItem,
  QuickProduct,
} from '@/types/pos';
import {
  applyGlobalDiscount,
  fixedDiscount,
  percentDiscount,
  roundHalfUp2,
  saleGrossTotal,
  type SaleDiscountLine,
} from '@/lib/saleDiscount';

// Reparto proporcional con residuo al último renglón (lib/saleDiscount.ts);
// se re-exporta para quien lo tomaba del store.
export { prorateDiscount } from '@/lib/saleDiscount';

interface PosCartStore {
  cart: PosCart;
  addItem: (product: QuickProduct, quantity?: number) => void;
  updateItemQuantity: (productId: string, quantity: number) => void;
  removeItem: (productId: string) => void;
  /** Completa el contenido ("Incluye") de una línea agregada sin él; lo
   *  resuelve PosScreen en segundo plano (el store se mantiene síncrono). */
  setItemComponents: (productId: string, components: KitComponent[]) => void;
  clearCart: () => void;
  /** Sustituye el carrito completo (pestañas de pedidos: al cambiar de
   *  pestaña entra el carrito estacionado de la otra). */
  loadCart: (cart: PosCart) => void;
  setCustomer: (
    customerId?: string,
    customerName?: string,
    customerRfc?: string,
    priceTypeId?: string,
    customerNumber?: string,
    customerEmail?: string,
  ) => void;
  setPublicPrice: (isPublic: boolean) => void;
  /** Correo capturado en caja para los boletos de evento (vacío = el del cliente). */
  setAttendeeEmail: (email?: string) => void;
  setDiscount: (
    discountPercent?: number,
    discountAmount?: number,
    discountReason?: string,
  ) => void;
  /** Fija el cupón validado por el API (código + descuento calculado). */
  setCoupon: (code: string, discount: number, description?: string) => void;
  clearCoupon: () => void;
  setRequiresInvoice: (requiresInvoice: boolean) => void;
  setNotes: (notes?: string) => void;
  /** Campaña de membresía que el ticket cumple (la fija el banner); null =
   *  ninguna. Viaja como membershipCampaignId al crear la venta. */
  setMembershipCampaignId: (campaignId: string | null) => void;
  /** "Aplicar en esta venta" del banner de membresía (default true). */
  setApplyMembership: (apply: boolean) => void;
  /** "Bolsa" de membresía elegida desde el catálogo (null = quitarla). Al
   *  cambiarla se limpia membershipCampaignId: la bolsa lo vuelve a fijar
   *  solo cuando el ticket cumple. */
  setMembershipSelected: (campaignId: string | null) => void;
  recalculateTotals: () => void;
  refreshItemPrices: (
    prices: Array<{
      productId: string;
      price: number;
      points: number;
      businessValue: number;
    }>,
  ) => void;
}

const DEFAULT_TAX_RATE = 0; // El API manda el rate correcto por pais.

// Redondeo a 2 decimales (dinero). Con sales tax US (impuesto añadido) el total
// sale con >2 decimales (ej. 48 * 0.0852 = 52.0896); sin redondear, el monto del
// pago se rechazaba en el API ("payments.0.amount must be a number ...").
// MITAD HACIA ARRIBA pese al float (7.175 se guarda como 7.17499999…): MISMA
// función que el API (pos/lib/money.lib.ts): el pago se arma con este total y
// el API lo valida al centavo contra el suyo (Santa Fe Springs, 13-oct-2026).
const round2 = roundHalfUp2;

const initialCart: PosCart = {
  items: [],
  subtotal: 0,
  taxAmount: 0,
  total: 0,
  totalPoints: 0,
  totalBusinessVolume: 0,
  requiresInvoice: false,
  membershipCampaignId: null,
  applyMembership: true,
  membershipSelectedId: null,
};

// Tope de cantidad de un item: maxQuantity explícito (derechos disponibles
// de la promo) o 1 por default si es promocional; sin tope para el resto.
const itemMaxQuantity = (item: PosCartItem): number | undefined =>
  item.maxQuantity ?? (item.productType === 'promotional' ? 1 : undefined);

/**
 * Importes de UN renglón. El descuento de LÍNEA manual (sin UI desde
 * ago-2026; latente) se calcula IGUAL que el API en createSale: a centavos
 * con la mitad hacia arriba, y `discountAmount` es el importe de TODA la
 * línea (no por unidad), que es lo que recibe CreateSaleDto.items[]
 * .discountAmount (máx. 2 decimales) y lo que PosScreen manda tal cual.
 * Sin redondear, un medio centavo exacto (0.03 × 50 % = 0.015) dejaba el
 * bruto del renglón 1¢ arriba del API (0.02 vs 0.01) y T, D y el total
 * dejaban de cuadrar; multiplicar por la cantidad volvía a multiplicar al
 * recalcular (cambio de cantidad). Idempotente.
 */
export const calculateItemTotal = (item: PosCartItem): PosCartItem => {
  const lineAmount = item.unitPrice * item.quantity;
  let lineDiscount = 0;

  if (item.discountPercent) {
    lineDiscount = round2(lineAmount * (item.discountPercent / 100));
  } else if (item.discountAmount) {
    lineDiscount = round2(item.discountAmount);
  }

  const afterDiscount = lineAmount - lineDiscount;
  const taxRate = item.taxRate ?? DEFAULT_TAX_RATE;

  let subtotal: number;
  let taxAmount: number;

  if (item.isIncludedInPrice) {
    subtotal = afterDiscount / (1 + taxRate);
    taxAmount = afterDiscount - subtotal;
  } else {
    subtotal = afterDiscount;
    taxAmount = subtotal * taxRate;
  }

  const total = subtotal + taxAmount;

  return {
    ...item,
    subtotal,
    taxAmount,
    total,
    discountAmount: lineDiscount,
  };
};

/**
 * Renglón del carrito tal como lo ve la lib de descuentos, que es EXACTAMENTE
 * como createSale del API arma sus `discountLines`: importe = precio ×
 * cantidad SIN redondear, descuento de línea manual ya a centavos (lo fija
 * calculateItemTotal), tasa decimal y si el precio incluye el impuesto.
 */
export const toDiscountLine = (item: PosCartItem): SaleDiscountLine => ({
  amount: item.unitPrice * item.quantity,
  lineDiscount: item.discountAmount ?? 0,
  rate: item.taxRate ?? DEFAULT_TAX_RATE,
  taxIncluded: item.isIncludedInPrice,
});

/**
 * Total CON impuesto del carrito ANTES del descuento global: T = round2(Σ
 * bruto_i SIN redondear por renglón) = round2(Σ item.total), la MISMA fórmula
 * que `saleGrossTotal` del API (pos/lib/sale-discount.lib.ts) y que el cobro
 * de siempre (2.0.86 y anteriores): dos renglones US de $10 @ 8.25 % dan
 * 21.65 (10.825 + 10.825), no 21.66. Es la BASE del cupón (lo que se manda a
 * validar al API) y del descuento manual, y no cambia al aplicar el cupón.
 * `subtotal + taxAmount` ya NO sirve como base: quedan con el descuento
 * aplicado y la re-validación del cupón se haría sobre un total cada vez
 * menor. El API valida el pago al centavo contra su T: si el API cambiara su
 * fórmula, lib/saleDiscount.ts cambia en la MISMA versión.
 */
export const cartGrossTotal = (items: PosCartItem[]): number =>
  saleGrossTotal(items.map(toDiscountLine));

/**
 * Totales del carrito. REGLA (Dirección/Sistemas, 29-oct-2026): el descuento
 * global —cupón o descuento manual— se calcula SOBRE EL TOTAL CON IMPUESTO
 * (T) y se prorratea entre los renglones en proporción a su bruto; de cada
 * neto se separa la base (neto / (1 + tasa)) y el impuesto (el resto). Por
 * eso `subtotal` y `taxAmount` quedan YA con el descuento aplicado,
 * `couponDiscount` / `discountAmount` es D (CON impuesto: lo que ve el
 * cliente en el ticket) y `total` = T − D = subtotal + taxAmount al centavo.
 *
 * MISMA regla y mismo redondeo que el API en createSale, vía
 * lib/saleDiscount.ts (espejo 1:1 de pos/lib/sale-discount.lib.ts): T =
 * round2(Σ bruto sin redondear); brutos a centavos con el residuo en el
 * último renglón con importe; D prorrateado sobre esos brutos; base_i del
 * neto exacto e impuesto_i = neto_i − base_i; cabecera subtotal = Σ base_i,
 * impuesto = total − subtotal, total = T − D. El total mostrado coincide con
 * el de la venta al centavo. Ejemplos canónicos (spec del API, portados a
 * pos-cart.store.test.ts):
 * - MX, $332 con IVA 16 % incluido, cupón 30 %: D 99.60 → neto 232.40, base
 *   200.34, IVA 32.06.
 * - MX mixto, $391 (IVA 0 %) + $332 (IVA 16 %), cupón 10 %: D 72.30 (partes
 *   39.10 y 33.20) → subtotal 609.49, IVA 41.21, total 650.70.
 * - US, $100 sin impuesto incluido, sales tax 8.25 %, cupón 10 %: bruto
 *   108.25, D 10.83 → base 90.00, impuesto 7.42, total 97.42.
 * - US sin descuento, 2 × $10 @ 8.25 %: T 21.65 (brutos 10.83 + 10.82);
 *   $70 + $30 @ 10.25 %: T 110.25, cabecera 100.00 / 10.25.
 * Los `items` conservan sus importes brutos (son para la UI); al API viaja el
 * carrito + el código del cupón (o el descuento manual) y él recalcula.
 */
export const calculateCartTotals = (cart: PosCart): PosCart => {
  // Carrito vacío = venta nueva: ningún descuento/cupón debe sobrevivir (el
  // cupón de la venta anterior se colaba a la siguiente al quitar items).
  if (cart.items.length === 0) {
    return {
      ...cart,
      subtotal: 0,
      taxAmount: 0,
      total: 0,
      totalPoints: 0,
      totalBusinessVolume: 0,
      discountPercent: undefined,
      discountAmount: undefined,
      discountReason: undefined,
      couponCode: undefined,
      couponDiscount: undefined,
      couponDescription: undefined,
      // Sin productos no hay puntos que cumplan una campaña de membresía.
      membershipCampaignId: null,
      applyMembership: true,
    };
  }

  const lines = cart.items.map(toDiscountLine);
  const grossTotal = saleGrossTotal(lines);

  // Cupón y descuento manual se excluyen (el API tampoco acepta ambos): con
  // cupón, el manual se descarta. El descuento del cupón ya lo calculó el API
  // sobre T (porcentaje con tope, o monto fijo) y aquí solo se acota; el
  // manual porcentual se calcula sobre T. Nunca negativo ni mayor que T.
  // El porcentaje manual va ANTES que el monto: el store reescribe
  // `discountAmount` con el monto derivado del porcentaje en cada recálculo
  // (si el carrito cambia, D cambia). El API recibe ambos y toma primero el
  // monto, que es ese mismo D: el resultado es idéntico.
  const hasCoupon = !!cart.couponCode;
  let discount = 0;
  if (hasCoupon) {
    discount = fixedDiscount(grossTotal, cart.couponDiscount ?? 0);
  } else if (cart.discountPercent) {
    discount = percentDiscount(grossTotal, cart.discountPercent);
  } else if (cart.discountAmount) {
    discount = fixedDiscount(grossTotal, cart.discountAmount);
  }

  // Prorrateo por renglón y desglose base / impuesto, idéntico al API:
  // subtotal = Σ base_i, taxAmount = total − subtotal, total = T − D.
  const amounts = applyGlobalDiscount(lines, discount);
  const { subtotal, tax: taxAmount, total } = amounts;

  const totalPoints = cart.items.reduce(
    (sum, item) => sum + item.points * item.quantity,
    0,
  );
  const totalBusinessVolume = cart.items.reduce(
    (sum, item) => sum + item.businessVolume * item.quantity,
    0,
  );

  return {
    ...cart,
    subtotal,
    taxAmount,
    total,
    totalPoints,
    totalBusinessVolume,
    ...(hasCoupon
      ? {
          couponDiscount: discount,
          discountPercent: undefined,
          discountAmount: undefined,
          discountReason: undefined,
        }
      : { discountAmount: discount > 0 ? discount : undefined }),
  };
};

// SIN persistencia a propósito: el carrito y el distribuidor seleccionado NO
// deben sobrevivir al cierre/reapertura del POS (cada arranque empieza limpio).
// Antes usaba persist('pos-cart-storage') y conservaba carrito + cliente.
export const usePosCartStore = create<PosCartStore>()(
    (set) => ({
      cart: initialCart,

      addItem: (product: QuickProduct, quantity = 1) => {
        set((state) => {
          const existingIndex = state.cart.items.findIndex(
            (item) => item.productId === product.id,
          );

          let newItems: PosCartItem[];

          if (existingIndex >= 0) {
            newItems = state.cart.items.map((item, index) => {
              if (index === existingIndex) {
                let newQty = item.quantity + quantity;
                if (item.stock != null && newQty > item.stock) {
                  newQty = item.stock;
                }
                const maxQty = itemMaxQuantity(item);
                if (maxQty != null && newQty > maxQty) {
                  newQty = maxQty;
                }
                if (newQty === item.quantity) return item;
                return calculateItemTotal({ ...item, quantity: newQty });
              }
              return item;
            });
          } else {
            const maxQty =
              product.maxQuantity ??
              (product.productType === 'promotional' ? 1 : undefined);
            let cappedQty =
              product.stock != null && quantity > product.stock
                ? product.stock
                : quantity;
            if (maxQty != null && cappedQty > maxQty) {
              cappedQty = maxQty;
            }
            // Ahora los kits también traen `stock` (armables / pieza propia):
            // con 0 el tope dejaría una línea en cantidad 0. No se agrega.
            if (cappedQty <= 0) return state;
            const newItem: PosCartItem = calculateItemTotal({
              productId: product.id,
              productSku: product.sku,
              productName: product.name,
              productImage: product.imageUrl,
              quantity: cappedQty,
              unitPrice: product.basePrice,
              taxRate: product.taxRate ?? DEFAULT_TAX_RATE,
              isIncludedInPrice: product.isIncludedInPrice ?? false,
              taxAmount: 0,
              subtotal: 0,
              total: 0,
              stock: product.stock,
              points: product.points ?? 0,
              businessVolume: product.businessVolume ?? 0,
              productType: product.productType,
              isEnrollmentKit: product.isEnrollmentKit,
              event: product.event,
              maxQuantity: maxQty,
              components: product.components,
              promoBySale: product.promoBySale,
              promoMinPoints: product.promoMinPoints,
            });
            newItems = [...state.cart.items, newItem];
          }

          return {
            cart: calculateCartTotals({ ...state.cart, items: newItems }),
          };
        });
      },

      updateItemQuantity: (productId: string, quantity: number) => {
        set((state) => {
          if (quantity <= 0) {
            const newItems = state.cart.items.filter(
              (item) => item.productId !== productId,
            );
            return {
              cart: calculateCartTotals({ ...state.cart, items: newItems }),
            };
          }

          const newItems = state.cart.items.map((item) => {
            if (item.productId === productId) {
              let cappedQty =
                item.stock != null && quantity > item.stock
                  ? item.stock
                  : quantity;
              const maxQty = itemMaxQuantity(item);
              if (maxQty != null && cappedQty > maxQty) {
                cappedQty = maxQty;
              }
              return calculateItemTotal({ ...item, quantity: cappedQty });
            }
            return item;
          });

          return {
            cart: calculateCartTotals({ ...state.cart, items: newItems }),
          };
        });
      },

      removeItem: (productId: string) => {
        set((state) => {
          const newItems = state.cart.items.filter(
            (item) => item.productId !== productId,
          );
          return {
            cart: calculateCartTotals({ ...state.cart, items: newItems }),
          };
        });
      },

      setItemComponents: (productId, components) => {
        set((state) => {
          const idx = state.cart.items.findIndex(
            (item) => item.productId === productId,
          );
          // La línea pudo quitarse mientras se consultaba; no hay totales
          // que recalcular (el contenido no cambia precios ni puntos).
          if (idx < 0) return state;
          const items = state.cart.items.map((item, i) =>
            i === idx ? { ...item, components } : item,
          );
          return { cart: { ...state.cart, items } };
        });
      },

      clearCart: () => {
        set({ cart: initialCart });
      },

      loadCart: (cart) => {
        set({
          cart: calculateCartTotals({
            ...cart,
            // Snapshots sin los campos de membresía (pestañas estacionadas
            // por una versión anterior) arrancan como un carrito nuevo.
            membershipCampaignId: cart.membershipCampaignId ?? null,
            applyMembership: cart.applyMembership ?? true,
            membershipSelectedId: cart.membershipSelectedId ?? null,
          }),
        });
      },

      setCustomer: (
        customerId,
        customerName,
        customerRfc,
        priceTypeId,
        customerNumber,
        customerEmail,
      ) => {
        set((state) => {
          // Las promociones son derechos del distribuidor seleccionado. Al
          // cambiar o quitar el distribuidor se retiran del carrito para que no
          // las canjee otro cliente.
          const items = state.cart.items.filter(
            (i) => i.productType !== 'promotional',
          );
          return {
            cart: calculateCartTotals({
              ...state.cart,
              items,
              customerId,
              customerName,
              customerNumber,
              customerRfc,
              customerEmail,
              // Al cambiar de cliente, el correo de los boletos vuelve al suyo.
              attendeeEmail: undefined,
              priceTypeId,
              isPublicPrice: false,
              // La campaña de membresía es del cliente anterior: el banner
              // la vuelve a fijar (o no) con las ofertas del nuevo.
              membershipCampaignId: null,
              applyMembership: true,
            }),
          };
        });
      },

      setAttendeeEmail: (email) => {
        set((state) => ({
          cart: { ...state.cart, attendeeEmail: email || undefined },
        }));
      },

      setPublicPrice: (isPublic) => {
        set((state) => {
          // Al pasar a venta pública (sin distribuidor) se retiran las promos.
          const items = isPublic
            ? state.cart.items.filter((i) => i.productType !== 'promotional')
            : state.cart.items;
          return {
            cart: calculateCartTotals({
              ...state.cart,
              items,
              isPublicPrice: isPublic,
              ...(isPublic
                ? {
                    customerId: undefined,
                    customerName: undefined,
                    customerNumber: undefined,
                    customerRfc: undefined,
                    customerEmail: undefined,
                    attendeeEmail: undefined,
                    priceTypeId: undefined,
                    membershipCampaignId: null,
                    applyMembership: true,
                  }
                : {}),
            }),
          };
        });
      },

      setMembershipCampaignId: (campaignId) => {
        set((state) => {
          if (state.cart.membershipCampaignId === campaignId) return state;
          return { cart: { ...state.cart, membershipCampaignId: campaignId } };
        });
      },

      setApplyMembership: (apply) => {
        set((state) => {
          if (state.cart.applyMembership === apply) return state;
          return { cart: { ...state.cart, applyMembership: apply } };
        });
      },

      setMembershipSelected: (campaignId) => {
        set((state) => {
          if (state.cart.membershipSelectedId === campaignId) return state;
          return {
            cart: {
              ...state.cart,
              membershipSelectedId: campaignId,
              membershipCampaignId: null,
              applyMembership: true,
            },
          };
        });
      },

      setCoupon: (code, discount, description) => {
        set((state) => ({
          cart: calculateCartTotals({
            ...state.cart,
            couponCode: code,
            couponDiscount: discount,
            couponDescription: description,
            // El cupón excluye el descuento manual (uno u otro).
            discountPercent: undefined,
            discountAmount: undefined,
            discountReason: undefined,
          }),
        }));
      },

      clearCoupon: () => {
        set((state) => ({
          cart: calculateCartTotals({
            ...state.cart,
            couponCode: undefined,
            couponDiscount: undefined,
            couponDescription: undefined,
          }),
        }));
      },

      setDiscount: (discountPercent, discountAmount, discountReason) => {
        set((state) => ({
          cart: calculateCartTotals({
            ...state.cart,
            discountPercent,
            discountAmount,
            discountReason,
          }),
        }));
      },

      setRequiresInvoice: (requiresInvoice) => {
        set((state) => ({
          cart: { ...state.cart, requiresInvoice },
        }));
      },

      setNotes: (notes) => {
        set((state) => ({
          cart: { ...state.cart, notes },
        }));
      },

      recalculateTotals: () => {
        set((state) => ({ cart: calculateCartTotals(state.cart) }));
      },

      refreshItemPrices: (prices) => {
        set((state) => {
          const priceMap = new Map(prices.map((p) => [p.productId, p]));
          const newItems = state.cart.items.map((item) => {
            const newPrice = priceMap.get(item.productId);
            if (!newPrice) return item;
            return calculateItemTotal({
              ...item,
              unitPrice: newPrice.price,
              points: newPrice.points,
              businessVolume: newPrice.businessValue,
            });
          });
          return {
            cart: calculateCartTotals({ ...state.cart, items: newItems }),
          };
        });
      },
    }),
);
