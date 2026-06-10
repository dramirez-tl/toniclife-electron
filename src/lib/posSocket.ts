// posSocket.ts - Conexión websocket (socket.io) del POS contra el namespace
// /pos del backend, para recibir en tiempo real el bloqueo por inventario.
//
// Auth: device_token en handshake.auth.token (el gateway lo valida igual que
// PosTerminalGuard). El backend asigna el socket al room de su sucursal y emite
// 'pos:lock' con el estado actual al conectar y en cada cambio.

import { io, type Socket } from 'socket.io-client';
import type { TransferIncomingEvent } from '@/types/pos';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api/v1';
// socket.io NO usa el prefix /api/v1 — vive en el origen del backend.
const API_ORIGIN = API_BASE_URL.replace(/\/api\/v1\/?$/, '');

export interface PosLockState {
  locked: boolean;
  message: string | null;
}

export type PosSocketStatus = 'connected' | 'disconnected' | 'error';

let socket: Socket | null = null;

export function connectPosSocket(
  deviceToken: string,
  onLock: (state: PosLockState) => void,
  onTransferIncoming?: (event: TransferIncomingEvent) => void,
  onStatus?: (status: PosSocketStatus, detail?: string) => void,
): void {
  disconnectPosSocket();
  socket = io(`${API_ORIGIN}/pos`, {
    auth: { token: deviceToken },
    reconnection: true,
    reconnectionDelay: 2_000,
  });
  socket.on('pos:lock', (state: PosLockState) => {
    onLock({ locked: !!state?.locked, message: state?.message ?? null });
  });
  if (onTransferIncoming) {
    socket.on('pos:transfer-incoming', (event: TransferIncomingEvent) => {
      onTransferIncoming(event);
    });
  }
  // Antes el POS callaba ante fallos del socket: si el token era rechazado en
  // el handshake, operaba para siempre sin lock ni traspasos en tiempo real.
  // Ahora se notifica al caller para avisar al cajero y dejar rastro.
  socket.on('connect', () => onStatus?.('connected'));
  socket.on('disconnect', (reason) => {
    console.warn(`[posSocket] desconectado: ${reason}`);
    onStatus?.('disconnected', reason);
  });
  socket.on('connect_error', (err) => {
    console.warn(`[posSocket] error de conexión: ${err.message}`);
    onStatus?.('error', err.message);
  });
}

export function disconnectPosSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}
