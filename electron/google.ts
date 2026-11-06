// google.ts - Inicio de sesión con Google para el MODO STAFF del POS.
//
// Google no permite iniciar sesión dentro de ventanas de Electron (lo bloquea
// como "navegador embebido"). El flujo correcto para apps de escritorio es:
//   1. abrir el navegador del SO con el cliente OAuth de tipo "Escritorio"
//      (PKCE S256, sin secreto en el POS);
//   2. Google regresa el código a un servidor local de UN SOLO USO en
//      127.0.0.1:puerto al azar (loopback);
//   3. el renderer manda código + verificador al API (POST /auth/google/desktop),
//      que es quien guarda el secreto del cliente y lo cambia por el ID token.
// Aquí solo vive el paso 1-2. Nunca se guarda nada en disco.

import http from 'node:http';
import crypto from 'node:crypto';
import { shell } from 'electron';

export type GoogleSignInResult =
  | { ok: true; code: string; codeVerifier: string; redirectUri: string }
  | { ok: false; error: string; cancelled?: boolean };

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
/** Tiempo máximo esperando a que el operador termine en el navegador. */
const SIGN_IN_TIMEOUT_MS = 3 * 60 * 1000;
const CLIENT_ID_RE = /^[\w.-]+\.apps\.googleusercontent\.com$/;

let cancelInFlight: (() => void) | null = null;

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function page(title: string, text: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Tonic Life POS</title>
<style>body{font-family:Segoe UI,Arial,sans-serif;background:#f4f7fa;color:#1f2937;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#fff;border-radius:16px;padding:32px 40px;box-shadow:0 10px 30px rgba(62,102,125,.15);max-width:420px;text-align:center}
h1{color:#3E667D;font-size:22px;margin:0 0 8px}p{margin:0;font-size:15px;line-height:1.5}</style></head>
<body><div class="card"><h1>${title}</h1><p>${text}</p></div></body></html>`;
}

/** Cancela el inicio de sesión en curso (el operador cerró el modal). */
export function cancelGoogleSignIn(): void {
  cancelInFlight?.();
}

/**
 * Abre el navegador con la pantalla de Google y espera el código. Resuelve
 * siempre (nunca lanza): { ok:false } con el motivo cuando el operador cancela,
 * se agota el tiempo o Google regresa un error.
 */
export function startGoogleSignIn(clientId: string): Promise<GoogleSignInResult> {
  if (typeof clientId !== 'string' || !CLIENT_ID_RE.test(clientId)) {
    return Promise.resolve({ ok: false, error: 'Cliente de Google inválido' });
  }
  // Un intento a la vez: el anterior se cancela.
  cancelInFlight?.();

  return new Promise((resolve) => {
    const verifier = base64url(crypto.randomBytes(32));
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    const state = base64url(crypto.randomBytes(16));
    let redirectUri = '';
    let done = false;

    const finish = (result: GoogleSignInResult) => {
      if (done) return;
      done = true;
      cancelInFlight = null;
      clearTimeout(timer);
      server.close();
      resolve(result);
    };

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.statusCode = 404;
        res.end();
        return;
      }
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      res.setHeader('content-type', 'text/html; charset=utf-8');
      if (error || !code || returnedState !== state) {
        res.end(
          page(
            'No se pudo iniciar sesión con Google',
            'Cierra esta pestaña y vuelve a intentarlo desde el POS.',
          ),
        );
        finish({
          ok: false,
          cancelled: error === 'access_denied',
          error:
            error === 'access_denied'
              ? 'Cancelaste el inicio de sesión con Google'
              : 'Google no entregó el código de acceso',
        });
        return;
      }
      res.end(page('Listo', 'Ya puedes cerrar esta pestaña y volver al POS de Tonic Life.'));
      finish({ ok: true, code, codeVerifier: verifier, redirectUri });
    });

    const timer = setTimeout(
      () => finish({ ok: false, error: 'Se agotó el tiempo para iniciar sesión con Google' }),
      SIGN_IN_TIMEOUT_MS,
    );
    cancelInFlight = () =>
      finish({ ok: false, cancelled: true, error: 'Se canceló el inicio de sesión con Google' });
    server.on('error', (err) => finish({ ok: false, error: err.message }));

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      redirectUri = `http://127.0.0.1:${port}/callback`;
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        prompt: 'select_account',
        access_type: 'online',
      });
      shell
        .openExternal(`${GOOGLE_AUTH_URL}?${params.toString()}`)
        .catch((err: unknown) =>
          finish({ ok: false, error: err instanceof Error ? err.message : String(err) }),
        );
    });
  });
}
