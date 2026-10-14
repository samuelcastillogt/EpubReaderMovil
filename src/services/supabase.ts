// Cliente Supabase minimo con fetch: sesion anonima o por correo (codigo OTP),
// respaldo, lista de espera y funciones (resumen IA).
import { config } from '../config';
import { readJson, writeJson } from '../storage/json';
import { createStore } from '../state/store';

type Session = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // ms
  userId: string;
  email?: string | null;
  isAnonymous: boolean;
};

const SESSION_KEY = 'supabase:session:v1';

export const accountStore = createStore<{ session: Session | null }>({ session: null });

export const supabaseEnabled = () => Boolean(config.supabaseUrl && config.supabaseAnonKey);

const baseHeaders = () => ({
  apikey: config.supabaseAnonKey as string,
  'Content-Type': 'application/json',
});

const toSession = (data: any): Session => ({
  accessToken: data.access_token,
  refreshToken: data.refresh_token,
  expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
  userId: data.user?.id,
  email: data.user?.email ?? null,
  isAnonymous: Boolean(data.user?.is_anonymous),
});

async function saveSession(session: Session | null) {
  accountStore.set({ session });
  await writeJson(SESSION_KEY, session);
}

async function authRequest(path: string, body: unknown) {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/${path}`, {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.msg || data?.error_description || data?.message || 'Error de autenticacion');
  }
  return data;
}

export async function restoreSession() {
  if (!supabaseEnabled()) return null;
  const saved = await readJson<Session | null>(SESSION_KEY, null);
  accountStore.set({ session: saved });
  return saved;
}

/** Devuelve una sesion valida; crea una anonima si no existe. */
export async function ensureSession(): Promise<Session> {
  if (!supabaseEnabled()) throw new Error('Supabase no esta configurado');
  let session = accountStore.get().session;
  if (!session) {
    session = toSession(await authRequest('signup', { data: {} }));
    await saveSession(session);
    return session;
  }
  if (session.expiresAt - Date.now() < 60_000) {
    try {
      session = toSession(
        await authRequest('token?grant_type=refresh_token', { refresh_token: session.refreshToken }),
      );
      await saveSession(session);
    } catch {
      await saveSession(null);
      return ensureSession();
    }
  }
  return session;
}

export async function sendEmailCode(email: string) {
  await authRequest('otp', { email, create_user: true });
}

export async function verifyEmailCode(email: string, token: string) {
  const session = toSession(await authRequest('verify', { email, token, type: 'email' }));
  await saveSession(session);
  return session;
}

export async function signOut() {
  await saveSession(null);
}

async function rest(path: string, init: RequestInit & { prefer?: string } = {}) {
  const session = await ensureSession();
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...baseHeaders(),
      Authorization: `Bearer ${session.accessToken}`,
      ...(init.prefer ? { Prefer: init.prefer } : null),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Error ${response.status}`);
  }
  return response;
}

export async function joinWaitlist(email: string, source: string) {
  await rest('waitlist', {
    method: 'POST',
    body: JSON.stringify({ email, source }),
    prefer: 'return=minimal',
  });
}

export async function uploadBackup(payload: unknown) {
  const session = await ensureSession();
  await rest('backups?on_conflict=user_id', {
    method: 'POST',
    body: JSON.stringify({ user_id: session.userId, payload, updated_at: new Date().toISOString() }),
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

export async function downloadBackup(): Promise<{ payload: any; updated_at: string } | null> {
  const session = await ensureSession();
  const response = await rest(`backups?user_id=eq.${session.userId}&select=payload,updated_at`);
  const rows = await response.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const session = await ensureSession();
  const response = await fetch(`${config.supabaseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: { ...baseHeaders(), Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `Error ${response.status}`) as Error & {
      code?: string;
    };
    error.code = data?.code;
    throw error;
  }
  return data as T;
}
