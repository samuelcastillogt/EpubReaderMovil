// Edge Function: resumen de capitulo con Claude.
// Secretos: ANTHROPIC_API_KEY (obligatorio), ANTHROPIC_MODEL (opcional), REVENUECAT_SECRET_KEY (opcional).
// Cuotas: gratis 1 resumen por libro; Pro 200 resumenes al mes (uso justo).
import { createClient } from 'npm:@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-haiku-4-5';
const REVENUECAT_SECRET_KEY = Deno.env.get('REVENUECAT_SECRET_KEY');
const FREE_PER_BOOK = 1;
const PRO_PER_MONTH = 200;
const MAX_CHARS = 60000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function isPro(userId: string) {
  if (!REVENUECAT_SECRET_KEY) return false;
  const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${REVENUECAT_SECRET_KEY}` },
  });
  if (!response.ok) return false;
  const data = await response.json();
  const pro = data?.subscriber?.entitlements?.pro;
  if (!pro) return false;
  return !pro.expires_date || new Date(pro.expires_date).getTime() > Date.now();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!ANTHROPIC_API_KEY) return json({ error: 'not_configured', message: 'Falta ANTHROPIC_API_KEY' }, 500);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (!user) return json({ error: 'unauthorized' }, 401);

  let body: { bookId?: string; bookTitle?: string; chapter?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const bookId = String(body.bookId ?? '').slice(0, 200);
  const text = String(body.text ?? '').slice(0, MAX_CHARS);
  if (!bookId || text.length < 200) return json({ error: 'bad_request', message: 'Texto insuficiente' }, 400);

  const pro = await isPro(user.id);
  if (pro) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from('ai_usage')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', since);
    if ((count ?? 0) >= PRO_PER_MONTH) {
      return json({ code: 'quota_exceeded', message: 'Alcanzaste el uso justo de este mes.' }, 429);
    }
  } else {
    const { count } = await admin
      .from('ai_usage')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('book_id', bookId);
    if ((count ?? 0) >= FREE_PER_BOOK) {
      return json({ code: 'quota_exceeded', message: 'El plan gratis incluye 1 resumen por libro.' }, 402);
    }
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 900,
      system:
        'Eres un tutor de estudio. Resumes capitulos para que un lector los recuerde. Escribe en espanol neutro, ' +
        'sin inventar datos que no esten en el texto. No copies parrafos completos del original.',
      messages: [
        {
          role: 'user',
          content:
            `Libro: ${String(body.bookTitle ?? '').slice(0, 200)}\nCapitulo: ${String(body.chapter ?? '').slice(0, 200)}\n\n` +
            'Devuelve en texto plano:\n1) Idea central en 2 frases.\n2) Entre 4 y 7 ideas clave en viñetas.\n' +
            '3) Tres preguntas de repaso.\n\nTexto del capitulo:\n' +
            text,
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error('anthropic_error', response.status, detail.slice(0, 500));
    return json({ error: 'ai_error', message: 'El servicio de IA no respondio. Intenta mas tarde.' }, 502);
  }
  const data = await response.json();
  const summary = (data?.content ?? [])
    .filter((block: { type: string }) => block.type === 'text')
    .map((block: { text: string }) => block.text)
    .join('\n')
    .trim();

  await admin.from('ai_usage').insert({ user_id: user.id, book_id: bookId, chars: text.length, model: MODEL });
  return json({ summary });
});
