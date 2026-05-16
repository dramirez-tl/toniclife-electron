// hardware.ts - Calcula un fingerprint determinista del equipo.
//
// El fingerprint se usa para vincular una licencia POS a UNA sola maquina.
// Debe ser estable en el tiempo (sobrevivir reinicios, actualizaciones del SO,
// cambios de IP), pero unico por equipo fisico.
//
// Ingredientes:
//   - os.platform()  -> 'win32' | 'darwin' | 'linux'
//   - os.arch()      -> 'x64' | 'arm64' | ...
//   - cpu[0].model   -> modelo de CPU
//   - mac primaria   -> primera MAC no-loopback no-virtual
//   - os.hostname()  -> hostname del equipo
//
// El SHA-256 hex de estos 5 datos concatenados es el fingerprint enviado a la API.
// Tambien retornamos un objeto "info" legible para que el admin pueda identificar
// el equipo en el listado de licencias del back office.

import os from 'node:os';
import { createHash } from 'node:crypto';

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

/** Encuentra la primera MAC no-loopback ni interna. */
function findPrimaryMac(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const addrs = interfaces[name];
    if (!addrs) continue;
    for (const addr of addrs) {
      if (
        !addr.internal &&
        addr.mac &&
        addr.mac !== '00:00:00:00:00:00'
      ) {
        return addr.mac;
      }
    }
  }
  return '00:00:00:00:00:00';
}

export function computeHardwareFingerprint(): HardwareFingerprint {
  const cpus = os.cpus();
  const info: HardwareInfo = {
    hostname: os.hostname(),
    cpuModel: cpus[0]?.model?.trim() ?? 'unknown',
    osPlatform: os.platform(),
    osRelease: os.release(),
    primaryMac: findPrimaryMac(),
    totalMemoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    cpuCount: cpus.length,
  };

  const ingredients = [
    info.osPlatform,
    os.arch(),
    info.cpuModel,
    info.primaryMac,
    info.hostname,
  ].join('|');

  const fingerprint = createHash('sha256').update(ingredients).digest('hex');

  return { fingerprint, info };
}
