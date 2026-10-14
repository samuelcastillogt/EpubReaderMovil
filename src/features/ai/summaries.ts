// Resumen de capitulo con IA. El texto va a una Edge Function de Supabase que llama al modelo;
// la clave de IA nunca vive en la app. El servidor aplica cuotas (gratis / Pro).
import { callFunction, supabaseEnabled } from '../../services/supabase';
import { track } from '../../services/analytics';
import { saveSummary } from '../../storage/summaries';
import { ChapterSummary } from '../../types';

export class SummaryQuotaError extends Error {}

export async function summarizeChapter(input: {
  bookId: string;
  bookTitle: string;
  href: string;
  chapter: string;
  text: string;
}): Promise<ChapterSummary> {
  if (!supabaseEnabled()) {
    throw new Error('Los resumenes requieren configurar Supabase (ver .env.example).');
  }
  if (input.text.length < 200) {
    throw new Error('Este capitulo tiene muy poco texto para resumir.');
  }
  track('summary_requested', { chars: input.text.length });
  try {
    const result = await callFunction<{ summary: string }>('summarize', {
      bookId: input.bookId,
      bookTitle: input.bookTitle,
      chapter: input.chapter,
      text: input.text,
    });
    const summary: ChapterSummary = {
      key: `${input.bookId}|${input.href}`,
      bookId: input.bookId,
      href: input.href,
      chapter: input.chapter,
      summary: result.summary,
      createdAt: Date.now(),
    };
    await saveSummary(summary);
    track('summary_completed');
    return summary;
  } catch (error) {
    const code = (error as { code?: string })?.code;
    track('summary_failed', { code });
    if (code === 'quota_exceeded') throw new SummaryQuotaError((error as Error).message);
    throw error;
  }
}
