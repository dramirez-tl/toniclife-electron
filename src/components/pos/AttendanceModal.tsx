// AttendanceModal - Checador de asistencia del personal de la sucursal.
//
// Flujo tipo kiosco (la terminal queda disponible para el siguiente empleado):
//   1) Se enciende la webcam y se muestra el preview (sin cámara no se puede
//      checar: la foto es la evidencia del registro).
//   2) El empleado teclea su NÚMERO de empleado y presiona Enter: la API lo
//      resuelve, devuelve su último toque del día y el tipo SUGERIDO.
//   3) Cuatro botones grandes (Entrada / Salida a comer / Regreso de comer /
//      Salida). Al tocar uno se captura el cuadro de la cámara y se envía como
//      multipart junto con el evento.
//   4) Pantalla de éxito 4 s (foto, nombre, hora local de la API) y se limpia.
//
// La sucursal REAL la resuelve el servidor (device token de la licencia); el
// branchId viaja para el modo staff y como fallback. La hora que se muestra es
// la que devuelve la API (hora local de la sucursal), no la del equipo.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  X,
  Fingerprint,
  Camera,
  CameraOff,
  Search,
  LogIn,
  Utensils,
  Undo2,
  LogOut,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { posApi } from '@/lib/posApi';
import { formatTime } from '@/lib/date';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import type {
  AttendanceEventType,
  AttendanceLookupResponse,
  AttendanceEventResponse,
} from '@/types/pos';

/** Etiquetas en español de los cuatro toques del checador. */
export const ATTENDANCE_EVENT_LABELS: Record<AttendanceEventType, string> = {
  check_in: 'Entrada',
  break_out: 'Salida a comer',
  break_in: 'Regreso de comer',
  check_out: 'Salida',
};

const EVENT_OPTIONS: {
  type: AttendanceEventType;
  label: string;
  Icon: LucideIcon;
}[] = [
  { type: 'check_in', label: 'Entrada', Icon: LogIn },
  { type: 'break_out', label: 'Salida a comer', Icon: Utensils },
  { type: 'break_in', label: 'Regreso de comer', Icon: Undo2 },
  { type: 'check_out', label: 'Salida', Icon: LogOut },
];

/** Duración de la pantalla de éxito antes de limpiar para el siguiente. */
const SUCCESS_MS = 4_000;

/** 'HH:MM:SS' → 'HH:MM' (la API manda la hora local ya materializada). */
function hhmm(localTime?: string): string {
  if (!localTime) return '--:--';
  return localTime.slice(0, 5);
}

/** data: URL → Blob sin pasar por fetch() (la CSP del build no permite blob:
 *  ni peticiones a data:). */
function dataUrlToBlob(dataUrl: string): Blob {
  const [head, base64] = dataUrl.split(',');
  const mime = /:(.*?);/.exec(head)?.[1] ?? 'image/jpeg';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Mensaje de error de la API (o el fallback). */
function apiMessage(err: unknown, fallback: string): string {
  const e = err as {
    response?: { data?: { message?: string | string[] } };
    message?: string;
  };
  const msg = e.response?.data?.message;
  if (Array.isArray(msg)) return msg[0] ?? fallback;
  return msg || e.message || fallback;
}

interface AttendanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Sucursal EFECTIVA que opera la terminal (incluye el modo staff). */
  branch: { id: string; code: string; name: string; timezone?: string };
}

export function AttendanceModal({
  isOpen,
  onClose,
  branch,
}: AttendanceModalProps) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  /** Nombres de las cámaras que Windows reporta (ayuda a soporte). */
  const [cameraDevices, setCameraDevices] = useState<string[]>([]);
  /** Contador para forzar un nuevo intento de encender la cámara. */
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [employeeNumber, setEmployeeNumber] = useState('');
  const [lookup, setLookup] = useState<AttendanceLookupResponse | null>(null);
  const [looking, setLooking] = useState(false);
  const [saving, setSaving] = useState<AttendanceEventType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    event: AttendanceEventResponse;
    photo: string;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const successTimerRef = useRef<number | null>(null);

  const { status } = useConnectionStatus();
  const offline = status === 'offline';
  const busy = looking || saving !== null;

  /** Apaga la cámara (libera el led/dispositivo al cerrar el modal). */
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  // Cámara: se enciende al abrir y se apaga SIEMPRE al cerrar/desmontar.
  // Robusta a lo que pasa en sucursal: cámara ocupada por otro programa (el
  // checador anterior en el navegador), USB que se desconecta y se vuelve a
  // conectar, drivers que rechazan la resolución pedida y el candado de
  // privacidad de Windows. Cada caso tiene su mensaje, hay botón Reintentar,
  // se reintenta solo cada 5 s mientras el modal siga abierto y se escucha
  // el evento devicechange para arrancar en cuanto vuelva la cámara.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    let retryTimer: number | null = null;
    setCameraError(null);
    const md = navigator.mediaDevices;

    const scheduleRetry = () => {
      if (cancelled || retryTimer !== null) return;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        if (!cancelled) setCameraAttempt((n) => n + 1);
      }, 5000);
    };

    const readLabels = async (): Promise<string[]> => {
      try {
        const devices = await md.enumerateDevices();
        return devices
          .filter((d) => d.kind === 'videoinput')
          .map((d, i) => d.label || `Cámara ${i + 1}`);
      } catch {
        return [];
      }
    };

    const run = async () => {
      if (!md?.getUserMedia) {
        setCameraError('Esta versión del POS no puede usar la cámara. Actualiza el POS.');
        return;
      }
      // Qué cámaras ve Windows (antes del permiso las etiquetas pueden venir
      // vacías; se vuelven a leer después de encenderla).
      const labels = await readLabels();
      if (cancelled) return;
      setCameraDevices(labels);

      const attempts: MediaStreamConstraints[] = [
        { video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
        { video: true, audio: false },
      ];
      let lastErr: unknown = null;
      for (const constraints of attempts) {
        try {
          const s = await md.getUserMedia(constraints);
          if (cancelled) {
            s.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = s;
          setStream(s);
          setCameraError(null);
          // Con permiso concedido las etiquetas ya vienen con nombre.
          const named = await readLabels();
          if (!cancelled && named.length > 0) setCameraDevices(named);
          // Si la cámara se desconecta a media sesión, avisar y reintentar.
          s.getVideoTracks().forEach((t) => {
            t.addEventListener('ended', () => {
              if (cancelled) return;
              stopCamera();
              setCameraError(
                'La cámara se desconectó. Revisa el cable USB; el checador la volverá a encender solo.',
              );
              scheduleRetry();
            });
          });
          return;
        } catch (err) {
          lastErr = err;
          const name = (err as { name?: string })?.name;
          // Solo vale la pena el segundo intento cuando el problema fue la
          // resolución pedida; los demás errores son de dispositivo/permiso.
          if (name !== 'OverconstrainedError' && name !== 'ConstraintNotSatisfiedError') break;
        }
      }
      if (cancelled) return;
      const name = (lastErr as { name?: string })?.name ?? '';
      const detected = labels.length > 0;
      let message: string;
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
        message =
          'Windows bloqueó el acceso a la cámara. Actívala en Configuración > Privacidad > Cámara (permitir a las aplicaciones de escritorio) y pulsa Reintentar.';
      } else if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
        message =
          'La cámara está conectada pero otro programa la está usando (por ejemplo el checador anterior en el navegador, Zoom o Teams). Ciérralo y pulsa Reintentar.';
      } else if (detected) {
        message = `La cámara no respondió (${name || 'error desconocido'}). Desconéctala y vuelve a conectarla; el checador reintenta solo.`;
      } else {
        message =
          'No se detectó una cámara conectada a esta terminal. Revisa el cable USB o prueba otro puerto; el checador la buscará solo cada 5 segundos.';
      }
      setCameraError(message);
      scheduleRetry();
    };

    void run();

    // Cámara que se conecta/desconecta mientras el modal está abierto.
    const onDeviceChange = () => {
      if (cancelled || streamRef.current) return;
      setCameraAttempt((n) => n + 1);
    };
    md?.addEventListener?.('devicechange', onDeviceChange);

    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      md?.removeEventListener?.('devicechange', onDeviceChange);
      stopCamera();
    };
  }, [isOpen, cameraAttempt, stopCamera]);

  // Enlaza el stream al <video> (srcObject, NO blob: — la CSP lo bloquearía).
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => {
      /* autoplay en muted: si falla, el usuario verá el aviso de cámara */
    });
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  // Limpieza al cerrar: nada del empleado anterior sobrevive al siguiente.
  useEffect(() => {
    if (isOpen) return;
    if (successTimerRef.current) window.clearTimeout(successTimerRef.current);
    successTimerRef.current = null;
    setEmployeeNumber('');
    setLookup(null);
    setLooking(false);
    setSaving(null);
    setError(null);
    setSuccess(null);
  }, [isOpen]);

  // El temporizador de la pantalla de éxito muere con el componente.
  useEffect(
    () => () => {
      if (successTimerRef.current) window.clearTimeout(successTimerRef.current);
    },
    [],
  );

  /** Deja la pantalla lista para el siguiente empleado. */
  const resetForNext = useCallback(() => {
    if (successTimerRef.current) window.clearTimeout(successTimerRef.current);
    successTimerRef.current = null;
    setSuccess(null);
    setLookup(null);
    setEmployeeNumber('');
    setError(null);
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleClose = () => {
    if (busy) return;
    stopCamera();
    onClose();
  };

  /** Busca al empleado por número y trae su último toque + tipo sugerido. */
  const handleLookup = async () => {
    const number = employeeNumber.trim();
    if (!number || looking) return;
    if (offline) {
      setError('Sin conexión con el servidor: no se puede checar.');
      return;
    }
    setLooking(true);
    setError(null);
    setLookup(null);
    try {
      const result = await posApi.lookupAttendanceEmployee(number, branch.id);
      setLookup(result);
    } catch (err) {
      const message = apiMessage(err, 'No se pudo consultar ese número');
      setError(message);
      toast.error(message);
      inputRef.current?.select();
    } finally {
      setLooking(false);
    }
  };

  /** Captura el cuadro actual de la cámara como data: URL JPEG. */
  const capturePhoto = (): string | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  };

  /** Registra el toque elegido con la foto del momento. */
  const handleRegister = async (eventType: AttendanceEventType) => {
    if (!lookup || busy) return;
    if (offline) {
      setError('Sin conexión con el servidor: no se puede checar.');
      return;
    }
    const photo = capturePhoto();
    if (!photo) {
      const message =
        'La cámara aún no está lista. Espera un momento e intenta de nuevo.';
      setError(message);
      toast.error(message);
      return;
    }
    setSaving(eventType);
    setError(null);
    try {
      const form = new FormData();
      form.append('employeeNumber', lookup.employee.employeeNumber);
      form.append('eventType', eventType);
      form.append('photo', dataUrlToBlob(photo), 'foto.jpg');
      const event = await posApi.registerAttendance(form, branch.id);
      setSuccess({ event, photo });
      toast.success(
        `${ATTENDANCE_EVENT_LABELS[event.eventType]} registrada — ${hhmm(
          event.localTime,
        )}`,
        { description: event.employee.name ?? event.employee.employeeNumber },
      );
      successTimerRef.current = window.setTimeout(resetForNext, SUCCESS_MS);
    } catch (err) {
      const message = apiMessage(err, 'No se pudo registrar el movimiento');
      setError(message);
      toast.error(message);
    } finally {
      setSaving(null);
    }
  };

  const otherBranch =
    !!lookup?.employee.branchId && lookup.employee.branchId !== branch.id;
  const canCheck = !!stream && !cameraError && !offline;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !busy) handleClose();
      }}
    >
      <DialogContent
        className="max-w-3xl max-h-[92vh] overflow-y-auto gap-0 p-0 rounded-2xl"
        showCloseButton={false}
        onInteractOutside={(e) => {
          if (busy) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault();
        }}
        onOpenAutoFocus={(e) => {
          // Kiosco: el foco va al número de empleado, no al botón de cerrar
          // (que en este modal es el primer elemento enfocable del DOM).
          e.preventDefault();
          window.setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >
        {/* Header */}
        <DialogHeader className="flex-row items-center justify-between space-y-0 px-6 py-4 border-b text-left">
          <div>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold text-foreground">
              <Fingerprint className="size-5 text-primary" />
              Checador
            </DialogTitle>
            <DialogDescription className="text-xs">
              Registra tu entrada, comida y salida — {branch.code} —{' '}
              {branch.name}
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={handleClose}
            disabled={busy}
            aria-label="Cerrar"
          >
            <X className="size-4 text-muted-foreground" />
          </Button>
        </DialogHeader>

        <div className="grid gap-5 px-6 py-5 md:grid-cols-[260px_1fr]">
          {/* Cámara: siempre montada (el <video> no se desmonta ni en éxito). */}
          <div className="space-y-2">
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border bg-black">
              <video
                ref={videoRef}
                muted
                playsInline
                autoPlay
                className={cn(
                  'h-full w-full object-cover',
                  !stream && 'opacity-0',
                )}
              />
              {!stream && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center text-xs text-white/80">
                  {cameraError ? (
                    <>
                      <CameraOff className="size-6" />
                      <span>{cameraError}</span>
                      <span className="text-[10px] text-white/60">
                        {cameraDevices.length > 0
                          ? `Cámaras detectadas: ${cameraDevices.join(', ')}`
                          : 'Windows no reporta ninguna cámara conectada.'}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="mt-1"
                        onClick={() => setCameraAttempt((n) => n + 1)}
                      >
                        Reintentar
                      </Button>
                    </>
                  ) : (
                    <>
                      <Loader2 className="size-6 animate-spin" />
                      <span>Encendiendo la cámara…</span>
                    </>
                  )}
                </div>
              )}
              {!!stream && <FaceGuide />}
              {!!stream && (
                <span className="absolute left-2 top-2 flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  <span className="size-1.5 rounded-full bg-red-500" />
                  EN VIVO
                </span>
              )}
              {!!stream && (
                <span className="absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white">
                  Coloca tu rostro dentro del óvalo
                </span>
              )}
            </div>
            <p className="flex items-start gap-1 text-[11px] text-muted-foreground">
              <Camera className="mt-px size-3 shrink-0" />
              La foto se toma en el momento de checar y queda guardada en tu
              registro de asistencia.
            </p>
          </div>

          {/* Flujo: número → tipo de movimiento → éxito */}
          <div className="min-w-0 space-y-3">
            {offline && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                <WifiOff className="size-4 shrink-0" />
                Sin conexión con el servidor. El checador vuelve solo en cuanto
                se restablezca la red.
              </div>
            )}

            {success ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-5 text-center">
                <img
                  src={success.photo}
                  alt="Foto del registro"
                  className="size-28 rounded-xl border-2 border-emerald-300 object-cover"
                />
                <div className="flex items-center gap-1.5 text-emerald-700">
                  <CheckCircle2 className="size-5" />
                  <span className="text-base font-bold">
                    {ATTENDANCE_EVENT_LABELS[success.event.eventType]}{' '}
                    registrada
                  </span>
                </div>
                <div className="text-sm font-semibold text-foreground">
                  {success.event.employee.name ?? success.event.employee.employeeNumber}
                </div>
                <div className="font-mono text-3xl font-bold tabular-nums text-emerald-800">
                  {hhmm(success.event.localTime)}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {success.event.branch.name} · {success.event.localDate} ·{' '}
                  {success.event.employee.employeeNumber}
                </div>
                {!success.event.photoUploaded && (
                  <p className="text-[11px] font-medium text-amber-700">
                    Tu registro quedó guardado, pero la foto no se pudo subir.
                  </p>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-1"
                  onClick={resetForNext}
                >
                  Listo — siguiente empleado
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="attendance-number">
                    Número de empleado
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="attendance-number"
                      ref={inputRef}
                      autoFocus
                      autoComplete="off"
                      inputMode="text"
                      placeholder="Ej. 1234"
                      value={employeeNumber}
                      onChange={(e) => {
                        setEmployeeNumber(e.target.value);
                        if (lookup) setLookup(null);
                        if (error) setError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleLookup();
                        }
                      }}
                      className="h-11 text-lg font-semibold tracking-wide"
                      disabled={looking || saving !== null}
                    />
                    <Button
                      className="h-11"
                      onClick={() => void handleLookup()}
                      disabled={!employeeNumber.trim() || busy}
                    >
                      {looking ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Search className="size-4" />
                      )}
                      Buscar
                    </Button>
                  </div>
                </div>

                {lookup && (
                  <div className="space-y-1 rounded-lg border bg-muted/40 px-3 py-2.5">
                    <div className="text-sm font-bold text-foreground">
                      {lookup.employee.name ?? lookup.employee.employeeNumber}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      No. {lookup.employee.employeeNumber}
                      {lookup.employee.branchName
                        ? ` · ${lookup.employee.branchName}`
                        : ''}
                    </div>
                    {otherBranch && (
                      <div className="flex items-center gap-1 text-[11px] font-medium text-amber-700">
                        <AlertTriangle className="size-3 shrink-0" />
                        Registrado en otra sucursal — se permite checar aquí.
                      </div>
                    )}
                    <div className="text-[11px] text-muted-foreground">
                      {lookup.lastEvent ? (
                        <>
                          Último movimiento de hoy:{' '}
                          <span className="font-semibold text-foreground">
                            {ATTENDANCE_EVENT_LABELS[
                              lookup.lastEvent.eventType
                            ] ?? lookup.lastEvent.eventType}
                          </span>{' '}
                          a las{' '}
                          {hhmm(lookup.lastEvent.localTime) !== '--:--'
                            ? hhmm(lookup.lastEvent.localTime)
                            : formatTime(
                                lookup.lastEvent.occurredAt,
                                branch.timezone,
                              )}
                        </>
                      ) : (
                        'Sin movimientos registrados hoy.'
                      )}
                    </div>
                  </div>
                )}

                {lookup && (
                  <div className="grid grid-cols-2 gap-2">
                    {EVENT_OPTIONS.map(({ type, label, Icon }) => {
                      const suggested = lookup.suggestedType === type;
                      return (
                        <Button
                          key={type}
                          variant={suggested ? 'default' : 'outline'}
                          className={cn(
                            'h-20 flex-col gap-1.5 rounded-xl text-sm font-semibold',
                            suggested &&
                              'ring-2 ring-primary/40 ring-offset-1',
                          )}
                          disabled={!canCheck || busy}
                          onClick={() => void handleRegister(type)}
                        >
                          {saving === type ? (
                            <Loader2 className="size-6 animate-spin" />
                          ) : (
                            <Icon className="size-6" />
                          )}
                          {label}
                          {suggested && (
                            <span className="text-[10px] font-normal opacity-80">
                              sugerido
                            </span>
                          )}
                        </Button>
                      );
                    })}
                  </div>
                )}

                {!lookup && !error && (
                  <p className="text-xs text-muted-foreground">
                    Teclea tu número de empleado y presiona <b>Enter</b>. Luego
                    elige el movimiento: entrada, salida a comer, regreso o
                    salida.
                  </p>
                )}

                {error && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                    <AlertTriangle className="mt-px size-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {lookup && !canCheck && !offline && (
                  <p className="text-[11px] font-medium text-amber-700">
                    Sin cámara no se puede registrar el movimiento.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Guía de encuadre sobre la cámara: óvalo donde debe quedar el rostro,
 * sombreado fuera del área y una silueta de hombros. Es solo visual (no
 * detecta la cara): sirve para que la foto de asistencia salga siempre
 * centrada y de frente, que es lo que la fase 2 (reconocimiento facial)
 * va a necesitar. El viewBox 400x300 coincide con el contenedor 4:3, así que
 * el óvalo no se deforma.
 */
function FaceGuide() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 400 300"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <mask id="pos-face-guide-mask">
          <rect width="400" height="300" fill="white" />
          <ellipse cx="200" cy="138" rx="80" ry="106" fill="black" />
        </mask>
      </defs>
      {/* Sombreado fuera del óvalo */}
      <rect width="400" height="300" fill="rgba(0,0,0,0.42)" mask="url(#pos-face-guide-mask)" />
      {/* Óvalo del rostro */}
      <ellipse
        cx="200"
        cy="138"
        rx="80"
        ry="106"
        fill="none"
        stroke="rgba(255,255,255,0.92)"
        strokeWidth="2.5"
        strokeDasharray="10 7"
      />
      {/* Hombros */}
      <path
        d="M88 300 C 118 238, 282 238, 312 300"
        fill="none"
        stroke="rgba(255,255,255,0.45)"
        strokeWidth="2.5"
        strokeDasharray="8 8"
      />
    </svg>
  );
}
