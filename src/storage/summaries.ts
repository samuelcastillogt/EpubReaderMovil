import { ChapterSummary } from '../types';
import { readJson, writeJson } from './json';

const KEY = 'epub:summaries:v1';

export async function loadSummaries(): Promise<Record<string, ChapterSummary>> {
  return readJson<Record<string, ChapterSummary>>(KEY, {});
}

export async function summariesForBook(bookId: string) {
  const all = await loadSummaries();
  return Object.values(all)
    .filter((item) => item.bookId === bookId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveSummary(summary: ChapterSummary) {
  const all = await loadSummaries();
  all[summary.key] = summary;
  await writeJson(KEY, all);
}

export async function replaceAllSummaries(next: Record<string, ChapterSummary>) {
  await writeJson(KEY, next);
}
