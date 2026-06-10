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
    isPosEnabled: boolean;
    posInventoryLocked: boolean;
    lockMessage: string | null;
  };
  hardware: {
    fingerprint: string;
    info: Record<string, unknown>;
  };
  serverTime: string;
}

/** Respuesta de POST /pos-licenses/heartbeat. */
export interface HeartbeatResponse {
  ok: true;
  serverTime: string;
  status: 'active';
  nextHeartbeatInSeconds: number;
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
  currencySymbol: string;
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  payments: Array<{ label: string; amount: number }>;
  amountReceived?: number;
  changeGiven: number;
  accumulatedPoints?: number;
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
