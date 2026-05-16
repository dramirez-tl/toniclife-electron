// activation.ts - Llamadas al modulo pos-licenses de la API.
//
// Cubre todo el ciclo de vida de la licencia desde la terminal:
//   - activate          : POST /pos-licenses/activate    (publico)
//   - validateLicense   : GET  /pos-licenses/me          (autenticado)
//   - heartbeat         : POST /pos-licenses/heartbeat   (autenticado)
//   - selfDeactivate    : POST /pos-licenses/deactivate  (autenticado)

import { api } from './api';
import { APP_VERSION } from './version';
import type {
  ActivationResponse,
  HardwareFingerprint,
  LicenseConflictPayload,
  TerminalLicenseInfo,
  HeartbeatResponse,
} from '@/types';

// ============================================================================
// ACTIVATE
// ============================================================================

export interface ActivationInput {
  licenseKey: string;
  hardware: HardwareFingerprint;
}

export type ActivationResult =
  | { kind: 'ok'; data: ActivationResponse }
  | { kind: 'not-found' }
  | { kind: 'revoked' }
  | { kind: 'conflict'; conflict: LicenseConflictPayload }
  | { kind: 'network-error'; message: string }
  | { kind: 'unknown-error'; message: string };

interface ConflictErrorBody {
  message?: string;
  conflict?: LicenseConflictPayload;
}

export async function activateLicense(
  input: ActivationInput,
): Promise<ActivationResult> {
  try {
    const { data } = await api.post<ActivationResponse>('/pos-licenses/activate', {
      licenseKey: input.licenseKey,
      hardwareFingerprint: input.hardware.fingerprint,
      hardwareInfo: input.hardware.info,
      appVersion: APP_VERSION,
    });
    return { kind: 'ok', data };
  } catch (err) {
    const e = err as {
      response?: { status: number; data?: ConflictErrorBody };
      message?: string;
    };

    if (!e.response) {
      return {
        kind: 'network-error',
        message: e.message ?? 'Sin conexion con el servidor',
      };
    }

    const status = e.response.status;
    const body = e.response.data;

    if (status === 404) return { kind: 'not-found' };
    if (status === 403) return { kind: 'revoked' };
    if (status === 409 && body?.conflict) {
      return { kind: 'conflict', conflict: body.conflict };
    }

    return { kind: 'unknown-error', message: body?.message ?? `Error ${status}` };
  }
}

// ============================================================================
// VALIDATE (GET /me)
// ============================================================================

export type ValidationResult =
  | { kind: 'ok'; data: TerminalLicenseInfo }
  | { kind: 'invalid' } // 401 (token bad) | 403 (license revoked / hardware mismatch)
  | { kind: 'network-error'; message: string };

export async function validateLicense(): Promise<ValidationResult> {
  try {
    const { data } = await api.get<TerminalLicenseInfo>('/pos-licenses/me');
    return { kind: 'ok', data };
  } catch (err) {
    const e = err as {
      response?: { status: number };
      message?: string;
    };
    if (!e.response) {
      return {
        kind: 'network-error',
        message: e.message ?? 'Sin conexion con el servidor',
      };
    }
    if (e.response.status === 401 || e.response.status === 403) {
      return { kind: 'invalid' };
    }
    return {
      kind: 'network-error',
      message: `Error ${e.response.status}`,
    };
  }
}

// ============================================================================
// HEARTBEAT
// ============================================================================

export type HeartbeatResult =
  | { kind: 'ok'; data: HeartbeatResponse }
  | { kind: 'invalid' }
  | { kind: 'network-error' };

export async function heartbeat(): Promise<HeartbeatResult> {
  try {
    const { data } = await api.post<HeartbeatResponse>('/pos-licenses/heartbeat', {
      appVersion: APP_VERSION,
    });
    return { kind: 'ok', data };
  } catch (err) {
    const e = err as { response?: { status: number } };
    if (!e.response) return { kind: 'network-error' };
    if (e.response.status === 401 || e.response.status === 403) {
      return { kind: 'invalid' };
    }
    return { kind: 'network-error' };
  }
}

// ============================================================================
// DEACTIVATE (self)
// ============================================================================

export async function selfDeactivate(): Promise<{ ok: boolean }> {
  try {
    await api.post('/pos-licenses/deactivate');
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
