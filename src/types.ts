// Tipos compartidos por el renderer.

export interface HardwareInfo {
  hostname: string;
  cpuModel: string;
  osPlatform: string;
  osRelease: string;
  primaryMac: string;
  totalMemoryGb: number;
  cpuCount: number;
}

export interface HardwareFingerprint {
  fingerprint: string;
  info: HardwareInfo;
}

export interface StoredSession {
  deviceToken: string;
  expiresAt: number;
  license: {
    id: string;
    licenseKey: string;
    label?: string;
    status: string;
    activatedAt: string;
  };
  branch: {
    id: string;
    code: string;
    name: string;
    timezone?: string;
    currencyCode?: string;
    ticketName?: string;
    /** Clave legacy de la sucursal (ej. "254"). */
    legacyKey?: string;
    /** País de la sucursal (branches.country_id → countries). undefined si no asignado. */
    country?: { code: string; name: string };
  };
  /**
   * Último estado conocido del interruptor global de operación del POS.
   * Se persiste para que, en un arranque sin conexión, la terminal recuerde si
   * estaba liberada o bloqueada (se reconfirma con el server en cuanto conecta).
   */
  operations?: {
    enabled: boolean;
    message?: string;
    /** Facturación habilitada en esta terminal (piloto doble captura: false =
     *  ocultar "Requiere factura"; la factura se emite en el sistema legacy). */
    invoicingEnabled?: boolean;
  };
}

export interface LicenseConflictPayload {
  licenseKey: string;
  activatedAt: string;
  existingHardwareFingerprint: string;
  existingHardwareInfo: HardwareInfo;
  branch: {
    id: string;
    code: string;
    name: string;
  };
}

export interface ActivationResponse {
  deviceToken: string;
  expiresIn: number;
  license: {
    id: string;
    licenseKey: string;
    label?: string;
    status: string;
    activatedAt: string;
  };
  branch: {
    id: string;
    code: string;
    name: string;
    timezone?: string;
    currencyCode?: string;
    ticketName?: string;
    /** Clave legacy de la sucursal (ej. "254"). */
    legacyKey?: string;
    /** País de la sucursal (branches.country_id → countries). undefined si no asignado. */
    country?: { code: string; name: string };
  };
}

/** Respuesta de GET /pos-licenses/me. */
export interface TerminalLicenseInfo {
  licenseId: string;
  licenseKey: string;
  label?: string;
  status: 'active';
  activatedAt: string;
  lastSeenAt: string;
  branch: {
    id: string;
    code: string;
    name: string;
    timezone?: string;
    currencyCode?: string;
    ticketName?: string;
    /** Clave legacy de la sucursal (ej. "254"). */
    legacyKey?: string;
    /** País de la sucursal (branches.country_id → countries). undefined si no asignado. */
    country?: { code: string; name: string };
    isPosEnabled: boolean;
    posInventoryLocked: boolean;
    lockMessage: string | null;
  };
  hardware: {
    fingerprint: string;
    info: Record<string, unknown>;
  };
  /** Interruptor global de operación del POS (system_settings pos.operations_enabled). */
  operationsEnabled: boolean;
  /** Leyenda a mostrar cuando operationsEnabled=false. */
  operationsMessage?: string;
  /** Facturación habilitada en esta terminal (undefined en APIs viejas = true). */
  invoicingEnabled?: boolean;
  serverTime: string;
}

/** Respuesta de POST /pos-licenses/heartbeat. */
export interface HeartbeatResponse {
  ok: true;
  serverTime: string;
  status: 'active';
  nextHeartbeatInSeconds: number;
  /** Interruptor global de operación del POS (re-aplicado en cada latido). */
  operationsEnabled: boolean;
  operationsMessage?: string;
  /** Facturación habilitada en esta terminal (undefined en APIs viejas = true). */
  invoicingEnabled?: boolean;
  /** Bloqueo por conteo de inventario (respaldo del socket — dictamen 2.1.5). */
  posInventoryLocked?: boolean;
  /** Leyenda a mostrar cuando posInventoryLocked=true. */
  lockMessage?: string;
  /** true si esta versión está por debajo de pos.min_app_version (dictamen 2.3.3). */
  updateRequired?: boolean;
  /** Versión mínima forzada configurada en el server. */
  minAppVersion?: string;
}

// ============================================================================
// IMPRESORA TERMICA (espejo de electron/printer.ts)
// ============================================================================

export interface PrinterConfig {
  connection: 'network' | 'system' | 'none';
  host?: string;
  port?: number;
  deviceName?: string;
  hasCashDrawer: boolean;
  paperWidth: 58 | 80;
  /** Impresora de MATRIZ DE PUNTO: tickets solo texto ("TONICLIFE" en vez
   *  del logo gráfico, que estas impresoras imprimen como basura). */
  dotMatrix?: boolean;
}

export interface OsPrinterInfo {
  name: string;
  displayName: string;
  description: string;
  status: number;
  isDefault: boolean;
}

export type PrinterOpResult = { ok: true } | { ok: false; error: string };

/** Payload del corte del dia para el handler de impresion (espejo de
 *  electron/receipts.ts CorteReceiptInput sin paperWidth — la elige el main
 *  desde la config persistida). */
export interface CorteReceiptPayload {
  branchName: string;
  date: string;
  currencySymbol: string;
  cashier?: string;
  totalSales: number;
  totalAmount: number;
  averageTicket: number;
  itemsSold: number;
  totalRefunds: number;
  refundsCount: number;
  payments: Array<{ label: string; amount: number }>;
  sales: Array<{
    saleNumber: string;
    createdAt: string;
    customerName?: string;
    total: number;
  }>;
}

/** Payload del ticket de venta (espejo de electron/receipts.ts
 *  SaleReceiptInput sin paperWidth — la elige el main desde la config). */
export interface SaleReceiptPayload {
  branchName: string;
  ticketName?: string;
  saleNumber: string;
  createdAt: string;
  cashier?: string;
  customerName?: string;
  /** Número de distribuidor/cliente (cotejo ante homónimos). */
  customerNumber?: string;
  currencySymbol: string;
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    total: number;
    /** Contenido de un kit/paquete/promo (lo que se entrega); quantity ya
     *  viene multiplicada por la cantidad de kits vendidos. */
    components?: Array<{ name: string; quantity: number }>;
  }>;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  payments: Array<{ label: string; amount: number }>;
  amountReceived?: number;
  changeGiven: number;
  /** Moneda de la venta (MXN/USD…) — se imprime bajo el TOTAL. */
  currencyCode?: string;
  /** Puntos de ESTA venta (el ticket los imprime sin decimales). */
  salePoints?: number;
  /** Saldo del periodo DESPUÉS de la venta ("Puntos totales"). */
  periodPoints?: number;
}

declare global {
  interface Window {
    toniclife: {
      hardware: {
        get: () => Promise<HardwareFingerprint>;
      };
      session: {
        load: () => Promise<StoredSession | null>;
        save: (session: StoredSession) => Promise<void>;
        clear: () => Promise<void>;
      };
      window: {
        setTitle: (title: string) => Promise<void>;
        close: () => Promise<void>;
      };
      app: {
        getUserDataPath: () => Promise<string>;
      };
      updater: {
        onUpdateDownloaded: (
          cb: (info: { version: string }) => void,
        ) => () => void;
        install: () => Promise<void>;
        /** Verificación manual de actualizaciones (no espera el ciclo de 4h). */
        check: () => Promise<{
          status: 'dev' | 'up-to-date' | 'update-available' | 'error';
          currentVersion: string;
          latestVersion?: string | null;
          message?: string;
        }>;
      };
      printer: {
        list: () => Promise<OsPrinterInfo[]>;
        loadConfig: () => Promise<PrinterConfig | null>;
        saveConfig: (config: PrinterConfig) => Promise<void>;
        testPrint: (
          config: PrinterConfig,
          branchName: string,
        ) => Promise<PrinterOpResult>;
        openCashDrawer: (config: PrinterConfig) => Promise<PrinterOpResult>;
        printCorte: (
          corte: CorteReceiptPayload,
        ) => Promise<PrinterOpResult>;
        printSale: (
          sale: SaleReceiptPayload,
          openDrawer: boolean,
        ) => Promise<PrinterOpResult>;
      };
    };
  }
}
