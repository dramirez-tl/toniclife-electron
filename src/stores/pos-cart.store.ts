// stores/pos-cart.store.ts - Zustand store del carrito POS.
// Portado verbatim de toniclife-next/src/stores/pos-cart.store.ts — la logica
// de calculo de impuestos/descuentos/totales es identica para mantener paridad.

import { create } from 'zustand';
import type { PosCart, PosCartItem, QuickProduct } from '@/types/pos';

interface PosCartStore {
  cart: PosCart;
  addItem: (product: QuickProduct, quantity?: number) => void;
  updateItemQuantity: (productId: string, quantity: number) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;
  setCustomer: (
    customerId?: string,
    customerName?: string,
    customerRfc?: string,
    priceTypeId?: string,
    customerNumber?: string,
  ) => void;
  setPublicPrice: (isPublic: boolean) => void;
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
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const initialCart: PosCart = {
  items: [],
  subtotal: 0,
  taxAmount: 0,
  total: 0,
  totalPoints: 0,
  totalBusinessVolume: 0,
  requiresInvoice: false,
};

const calculateItemTotal = (item: PosCartItem): PosCartItem => {
  const lineAmount = item.unitPrice * item.quantity;
  let lineDiscount = 0;

  if (item.discountPercent) {
    lineDiscount = lineAmount * (item.discountPercent / 100);
  } else if (item.discountAmount) {
    lineDiscount = item.discountAmount * item.quantity;
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

const calculateCartTotals = (cart: PosCart): PosCart => {
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
    };
  }
  const subtotal = cart.items.reduce((sum, item) => sum + item.subtotal, 0);

  let globalDiscount = 0;
  if (cart.discountPercent) {
    globalDiscount = subtotal * (cart.discountPercent / 100);
  } else if (cart.discountAmount) {
    globalDiscount = cart.discountAmount;
  }

  let taxAmount: number;
  if (globalDiscount > 0 && subtotal > 0) {
    const discountFactor = 1 - globalDiscount / subtotal;
    taxAmount = cart.items.reduce((sum, item) => {
      const rate = item.taxRate ?? DEFAULT_TAX_RATE;
      return sum + item.subtotal * discountFactor * rate;
    }, 0);
  } else {
    taxAmount = cart.items.reduce((sum, item) => sum + item.taxAmount, 0);
  }

  // El descuento de CUPÓN se resta del total SIN recalcular impuestos: así el
  // total mostrado coincide EXACTO con el que calcula el API en createSale
  // (subtotal - descuento + impuestos íntegros). El API valida el cupón sobre
  // subtotal+impuestos, por eso el % del cupón "incluye" el impuesto.
  const couponDiscount = cart.couponCode ? (cart.couponDiscount ?? 0) : 0;
  const total = subtotal - globalDiscount + taxAmount - couponDiscount;

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
    subtotal: round2(subtotal),
    discountAmount: globalDiscount ? round2(globalDiscount) : undefined,
    taxAmount: round2(taxAmount),
    total: round2(Math.max(0, total)),
    totalPoints,
    totalBusinessVolume,
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
                if (newQty === item.quantity) return item;
                return calculateItemTotal({ ...item, quantity: newQty });
              }
              return item;
            });
          } else {
            const cappedQty =
              product.stock != null && quantity > product.stock
                ? product.stock
                : quantity;
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
              components: product.components,
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
              const cappedQty =
                item.stock != null && quantity > item.stock
                  ? item.stock
                  : quantity;
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

      clearCart: () => {
        set({ cart: initialCart });
      },

      setCustomer: (
        customerId,
        customerName,
        customerRfc,
        priceTypeId,
        customerNumber,
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
              priceTypeId,
              isPublicPrice: false,
            }),
          };
        });
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
                    priceTypeId: undefined,
                  }
                : {}),
            }),
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
