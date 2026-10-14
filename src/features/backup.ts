// Respaldo en la nube de subrayados, notas, repaso, resumenes y biblioteca (sin los archivos EPUB).
import { downloadBackup, uploadBackup } from '../services/supabase';
import { track } from '../services/analytics';
import { loadHighlights, replaceAllHighlights } from '../storage/highlights';
import { loadLibrary } from '../storage/library';
import { loadSummaries, replaceAllSummaries } from '../storage/summaries';
import { Highlight } from '../types';
import { loadReviewData, saveReviewData } from './review/reviewStore';

const BACKUP_VERSION = 1;

export async function backupNow() {
  const [highlights, review, summaries, library] = await Promise.all([
    loadHighlights(),
    loadReviewData(),
    loadSummaries(),
    loadLibrary(),
  ]);
  await uploadBackup({
    version: BACKUP_VERSION,
    createdAt: Date.now(),
    highlights,
    review,
    summaries,
    library: library.map(({ id, title, name, progress }) => ({ id, title, name, progress })),
  });
  track('backup_done', { highlights: highlights.length });
}

/** Restaura combinando con lo local: no borra nada que exista en el dispositivo. */
export async function restoreFromBackup() {
  const remote = await downloadBackup();
  if (!remote?.payload) return { restored: 0 };
  const payload = remote.payload;

  const local = await loadHighlights();
  const byId = new Map<string, Highlight>(local.map((item) => [item.id, item]));
  for (const item of (payload.highlights ?? []) as Highlight[]) {
    const current = byId.get(item.id);
    if (!current || current.updatedAt < item.updatedAt) byId.set(item.id, item);
  }
  await replaceAllHighlights([...byId.values()]);

  const review = await loadReviewData();
  await saveReviewData({
    ...review,
    cards: { ...(payload.review?.cards ?? {}), ...review.cards },
    days: { ...(payload.review?.days ?? {}), ...review.days },
  });
  await replaceAllSummaries({ ...(payload.summaries ?? {}), ...(await loadSummaries()) });

  track('backup_restored', { highlights: (payload.highlights ?? []).length });
  return { restored: (payload.highlights ?? []).length as number, updatedAt: remote.updated_at };
}
