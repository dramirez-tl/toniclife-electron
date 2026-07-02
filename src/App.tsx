// App.tsx - Router minimo del POS Electron.
//
// Estados:
//   - 'loading'      : leyendo sesion + computando fingerprint + validando.
//   - 'activation'   : pantalla inicial de captura de clave.
//   - 'conflict'     : la licencia ya esta en otro equipo (409).
//   - 'pos'          : terminal activa, mostrando POS (placeholder en fase 3).
//
// Flujo al arranque:
//   1) Computar hardware fingerprint.
//   2) Cargar sesion guardada (si existe).
//   3) Si hay sesion: llamar GET /pos-licenses/me para revalidar contra server.
//      - 200 OK    -> state='pos' con info actualizada.
//      - 401/403   -> sesion invalida (revoked/hardware-mismatch/expired) ->
//                     clear + state='activation'.
//      - network   -> mantener sesion local (modo "online-cuando-puedas"),
//                     mostrar POS pero seguir intentando heartbeat.
//   4) Si no hay sesion: state='activation' directo.
//
// Heartbeat: cada 60s mientras estemos en 'pos'. Si falla con 'invalid',
// hace logout. Si falla con 'network-error', ignora (no cortar la terminal
// por una caida transitoria del backend).

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LogoMark } from '@/components/LogoMark';
import type {
  ActivationResponse,
  HardwareFingerprint,
  LicenseConflictPayload,
  StoredSession,
} from '@/types';
import { setDeviceToken, onApiUnauthorized } from '@/lib/api';
import {
  validateLicense,
  heartbeat as sendHeartbeat,
  selfDeactivate,
} from '@/lib/activation';
import { ActivationScreen } from '@/screens/ActivationScreen';
import { LicenseConflictScreen } from '@/screens/LicenseConflictScreen';
import { PosScreen } from '@/screens/PosScreen';
import { InventoryLockScreen } from '@/screens/InventoryLockScreen';
import { connectPosSocket, disconnectPosSocket, type PosLockState } from '@/lib/posSocket';
import { Toaster } from '@/components/ui/sonner';

type AppState =
  | { kind: 'loading' }
  | { kind: 'activation' }
  | { kind: 'conflict'; conflict: LicenseConflictPayload }
  | { kind: 'pos'; session: StoredSession };

/** Estado del interruptor global de operación del POS (liberado/bloqueado). */
type PosOperations = { enabled: boolean; message: string | null };

const HEARTBEAT_INTERVAL_MS = 60_000; // 60s

export function App() {
  const [state, setState] = useState<AppState>({ kind: 'loading' });
  const [hardware, setHardware] = useState<HardwareFingerprint | null>(null);
  const [windowTitle, setWindowTitle] = useState('Tonic Life POS');
  const [lock, setLock] = useState<PosLockState>({ locked: false, message: null });
  // Interruptor de liberación del POS. Default BLOQUEADO: una terminal recién
  // activada no debe operar hasta que el server confirme que está liberada.
  const [posOps, setPosOps] = useState<PosOperations>({
    enabled: false,
    message: null,
  });
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const queryClient = useQueryClient();

  // ------------------------------------------------------------------
  // Bootstrap: hardware + sesion + revalidacion contra server
  // ------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      const hw = await window.toniclife.hardware.get();
      setHardware(hw);

      const stored = await window.toniclife.session.load();
      console.log(
        '[POS] Sesion local:',
        stored
          ? {
              licenseKey: stored.license.licenseKey,
              branch: stored.branch.code,
              expiresAt: new Date(stored.expiresAt).toISOString(),
              hasToken: !!stored.deviceToken,
            }
          : 'ninguna',
      );

      if (!stored || stored.expiresAt <= Date.now()) {
        if (stored) {
          console.warn('[POS] La sesion local expiro (timestamp local).');
          await window.toniclife.session.clear();
        }
        setState({ kind: 'activation' });
        return;
      }

      // Hay sesion local — colocar token y validar contra server.
      setDeviceToken(stored.deviceToken);
      // Estado de liberación conocido (evita parpadeo mientras validamos).
      if (stored.operations) {
        setPosOps({
          enabled: stored.operations.enabled,
          message: stored.operations.message ?? null,
        });
      }
      const result = await validateLicense();
      console.log('[POS] Resultado de validateLicense:', result.kind);

      if (result.kind === 'ok') {
        // Refrescar datos locales con lo que devolvio el server (nombre de
        // sucursal pudo haber cambiado, status sigue active, etc.).
        const updated: StoredSession = {
          ...stored,
          license: {
            ...stored.license,
            label: result.data.label,
            status: result.data.status,
            activatedAt: result.data.activatedAt,
          },
          branch: {
            id: result.data.branch.id,
            code: result.data.branch.code,
            name: result.data.branch.name,
            timezone: result.data.branch.timezone,
            currencyCode: result.data.branch.currencyCode,
            ticketName: result.data.branch.ticketName,
            legacyKey: result.data.branch.legacyKey,
            country: result.data.branch.country,
          },
          operations: {
            enabled: result.data.operationsEnabled,
            message: result.data.operationsMessage,
          },
        };
        await window.toniclife.session.save(updated);
        setPosOps({
          enabled: result.data.operationsEnabled,
          message: result.data.operationsMessage ?? null,
        });
        // Estado de bloqueo inicial (el socket lo confirmará/actualizará al conectar).
        setLock({
          locked: result.data.branch.posInventoryLocked ?? false,
          message: result.data.branch.lockMessage ?? null,
        });
        setState({ kind: 'pos', session: updated });
        setWindowTitle(
          `Tonic Life POS · Sucursal ${updated.branch.code} — ${updated.branch.name}`,
        );
      } else if (result.kind === 'invalid') {
        // 401: el interceptor ya limpio la sesion y mostro el toast.
        // 403: limpiamos aqui (la API rechazo por revoke/hardware mismatch).
        setDeviceToken(null);
        await window.toniclife.session.clear();
        setState({ kind: 'activation' });
      } else {
        // network-error: mantener la sesion local — el heartbeat reintentara.
        toast.warning(`Sin conexion con el servidor: ${result.message}`);
        setState({ kind: 'pos', session: stored });
        setWindowTitle(
          `Tonic Life POS · Sucursal ${stored.branch.code} — ${stored.branch.name}`,
        );
      }
    })().catch((err) => {
      console.error('Error al inicializar la terminal:', err);
      setState({ kind: 'activation' });
    });
  }, []);

  // ------------------------------------------------------------------
  // Interceptor de 401 → limpia sesion y vuelve a activacion
  // ------------------------------------------------------------------
  useEffect(() => {
    onApiUnauthorized(async (reason) => {
      console.warn('[POS] Sesion invalidada por la API:', reason);
      setDeviceToken(null);
      await window.toniclife.session.clear();
      toast.error(`Sesion invalidada por el servidor: ${reason}`, {
        duration: 6000,
      });
      setState({ kind: 'activation' });
    });
  }, []);

  // ------------------------------------------------------------------
  // Heartbeat periodico mientras estemos en 'pos'
  // ------------------------------------------------------------------
  useEffect(() => {
    if (state.kind !== 'pos') {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      return;
    }

    heartbeatRef.current = setInterval(async () => {
      const r = await sendHeartbeat();
      if (r.kind === 'invalid') {
        // Licencia revocada o hardware mismatch: cerrar sesion.
        setDeviceToken(null);
        await window.toniclife.session.clear();
        toast.error('La licencia fue revocada. Vuelve a activar la terminal.');
        setState({ kind: 'activation' });
        return;
      }
      if (r.kind === 'ok') {
        // Re-aplicar el interruptor global de operación (liberar/bloquear sin
        // reiniciar). Persistir (merge sobre la sesión más reciente) para
        // recordar el estado en un arranque offline.
        setPosOps({
          enabled: r.data.operationsEnabled,
          message: r.data.operationsMessage ?? null,
        });
        const latest = await window.toniclife.session.load();
        if (latest) {
          await window.toniclife.session
            .save({
              ...latest,
              operations: {
                enabled: r.data.operationsEnabled,
                message: r.data.operationsMessage,
              },
            })
            .catch(() => {});
        }
      }
      // network-error: ignorar; el siguiente tick reintentara.
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, [state.kind]);

  // ------------------------------------------------------------------
  // Socket /pos: bloqueo por inventario en tiempo real (solo en 'pos')
  // ------------------------------------------------------------------
  const sessionToken = state.kind === 'pos' ? state.session.deviceToken : null;
  useEffect(() => {
    if (!sessionToken) {
      disconnectPosSocket();
      setLock({ locked: false, message: null });
      return;
    }
    // Avisar al cajero solo en TRANSICIONES (caída sostenida / recuperación),
    // no en cada reintento de socket.io.
    let socketDown = false;
    connectPosSocket(
      sessionToken,
      (s) => setLock(s),
      (event) => {
        // Llegó un traspaso nuevo hacia esta sucursal: refrescar el badge/lista
        // de entradas y avisar al cajero.
        void queryClient.invalidateQueries({
          queryKey: ['pos', 'incoming-transfers'],
        });
        toast.info(
          `Traspaso entrante ${event.movementNumber} de ${event.originBranchName}`,
          { description: `${event.totalItems} producto(s) por recibir` },
        );
      },
      (status, detail) => {
        if (status === 'connected') {
          if (socketDown) {
            socketDown = false;
            toast.success('Conexión en tiempo real restablecida');
          }
          return;
        }
        if (!socketDown) {
          socketDown = true;
          toast.warning(
            'Sin conexión en tiempo real con el servidor',
            {
              description:
                'Bloqueos de inventario y traspasos pueden llegar con retraso. ' +
                (detail ? `Detalle: ${detail}` : 'Reintentando…'),
            },
          );
        }
      },
    );
    return () => disconnectPosSocket();
  }, [sessionToken, queryClient]);

  // ------------------------------------------------------------------
  // Titulo de la ventana
  // ------------------------------------------------------------------
  useEffect(() => {
    window.toniclife.window.setTitle(windowTitle).catch(() => {});
  }, [windowTitle]);

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------
  async function handleActivated(response: ActivationResponse) {
    const session: StoredSession = {
      deviceToken: response.deviceToken,
      expiresAt: Date.now() + response.expiresIn * 1000,
      license: response.license,
      branch: response.branch,
    };
    await window.toniclife.session.save(session);
    setDeviceToken(session.deviceToken);
    setState({ kind: 'pos', session });
    setWindowTitle(
      `Tonic Life POS · Sucursal ${session.branch.code} — ${session.branch.name}`,
    );
  }

  function handleConflict(conflict: LicenseConflictPayload) {
    setState({ kind: 'conflict', conflict });
  }

  function handleBackToActivation() {
    setState({ kind: 'activation' });
  }

  async function handleLogout() {
    // Pedir al server que libere la licencia (auto-deactivate). Si falla
    // por red, igual limpiamos local — el admin puede liberarla manualmente.
    const r = await selfDeactivate();
    if (!r.ok) {
      toast.warning(
        'No se pudo notificar al servidor. La licencia quedara activa hasta que un admin la libere.',
      );
    } else {
      toast.success('Terminal desactivada. La licencia quedo libre para otro equipo.');
    }
    setDeviceToken(null);
    await window.toniclife.session.clear();
    setState({ kind: 'activation' });
    setWindowTitle('Tonic Life POS · Activacion de Terminal');
  }

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex-1 overflow-hidden">
        {state.kind === 'loading' && (
          <div className="h-full w-full flex flex-col items-center justify-center gap-6 bg-primary text-primary-foreground">
            <LogoMark size={120} variant="blue-outline" />
            <div className="text-center">
              <div className="text-2xl font-bold">Tonic Life POS</div>
              <div className="mt-2 text-sm text-white/75 flex items-center justify-center gap-2">
                <span className="inline-block size-2 rounded-full bg-white/80 animate-pulse" />
                Inicializando terminal...
              </div>
            </div>
          </div>
        )}
        {state.kind === 'activation' && (
          <ActivationScreen
            hardware={hardware}
            onActivated={handleActivated}
            onConflict={handleConflict}
          />
        )}
        {state.kind === 'conflict' && (
          <LicenseConflictScreen
            conflict={state.conflict}
            currentHardware={hardware}
            onBack={handleBackToActivation}
          />
        )}
        {state.kind === 'pos' && (
          <PosScreen
            session={state.session}
            onLogout={handleLogout}
            operationsEnabled={posOps.enabled}
            operationsMessage={posOps.message}
          />
        )}
      </div>
      {state.kind === 'pos' && lock.locked && (
        <div className="fixed inset-0 z-50">
          <InventoryLockScreen
            message={lock.message}
            branchName={state.session.branch.name}
          />
        </div>
      )}
      <Toaster />
    </div>
  );
}
