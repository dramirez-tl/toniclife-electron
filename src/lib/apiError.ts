// apiError.ts - Mensaje legible de un error del API para mostrarlo al cajero.
//
// NestJS responde 4xx con `{ statusCode, message, error }`; `message` es un
// texto (BadRequestException('...')) o un ARREGLO de textos (ValidationPipe).
// Antes el POS hacía `e.response?.data?.message || ...`: con arreglo el toast
// pegaba los textos sin separador, y sin respuesta (red caída) enseñaba el
// "Request failed with status code" de axios en inglés.

interface ApiErrorLike {
  response?: {
    status?: number;
    data?: { message?: string | string[]; error?: string } | string;
  };
  message?: string;
  code?: string;
}

/** Texto completo del error del API (o el `fallback` si no trae mensaje). */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  const e = (err ?? {}) as ApiErrorLike;
  const data = e.response?.data;
  if (typeof data === 'string') {
    // Cuerpo string: solo si es un texto corto y no HTML (un 502/504 del proxy
    // trae una pagina HTML completa que no debe ir al toast).
    const t = data.trim();
    if (t && !t.startsWith('<') && t.length <= 200) return t;
  }
  if (data && typeof data === 'object') {
    const m = data.message;
    if (Array.isArray(m)) {
      const joined = m.map((s) => String(s).trim()).filter(Boolean).join(' · ');
      if (joined) return joined;
    } else if (typeof m === 'string' && m.trim()) {
      return m.trim();
    }
  }
  if (!e.response) {
    // Sin respuesta HTTP: red/servidor caído. No repetir el texto de axios.
    if (e.code === 'ECONNABORTED') return 'El servidor tardó demasiado en responder. Inténtalo de nuevo.';
    if (e.message && /network error/i.test(e.message)) {
      return 'Sin conexión con el servidor. Revisa la red e inténtalo de nuevo.';
    }
    return fallback;
  }
  // Hubo respuesta pero sin mensaje usable (HTML del proxy, cuerpo vacio…).
  if (typeof e.response.status === 'number') {
    return `Error del servidor (HTTP ${e.response.status})`;
  }
  return fallback;
}

/**
 * Duración del toast según el largo del mensaje: los rechazos del servidor
 * ("Stock insuficiente para componente "X" del kit Y (requiere 1, hay 0)")
 * deben poder leerse completos; 4 s (default de sonner) no alcanza.
 */
export function toastDurationFor(message: string): number {
  if (message.length > 140) return 15_000;
  if (message.length > 70) return 10_000;
  return 6_000;
}
