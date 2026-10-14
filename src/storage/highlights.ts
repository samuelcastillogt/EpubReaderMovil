import { Highlight } from '../types';
import { newId, readJson, writeJson } from './json';

const KEY = 'epub:highlights:v1';
let cache: Highlight[] | null = null;
const listeners = new Set<() => void>();

export async function loadHighlights(): Promise<Highlight[]> {
  if (cache) return cache;
  const parsed = await readJson<Highlight[]>(KEY, []);
  cache = Array.isArray(parsed) ? parsed : [];
  return cache;
}

async function save(next: Highlight[]) {
  cache = next;
  await writeJson(KEY, next);
  listeners.forEach((listener) => listener());
}

export function onHighlightsChanged(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function highlightsForBook(bookId: string) {
  return (await loadHighlights()).filter((item) => item.bookId === bookId);
}

export async function addHighlight(input: Omit<Highlight, 'id' | 'createdAt' | 'updatedAt'>) {
  const all = await loadHighlights();
  const existing = all.find((item) => item.bookId === input.bookId && item.cfi === input.cfi);
  if (existing) return existing;
  const now = Date.now();
  const highlight: Highlight = { ...input, id: newId(), createdAt: now, updatedAt: now };
  await save([...all, highlight]);
  return highlight;
}

export async function updateHighlight(id: string, patch: Partial<Pick<Highlight, 'note' | 'text'>>) {
  const all = await loadHighlights();
  await save(all.map((item) => (item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item)));
}

export async function removeHighlight(id: string) {
  const all = await loadHighlights();
  await save(all.filter((item) => item.id !== id));
}

export async function replaceAllHighlights(next: Highlight[]) {
  await save(next);
}
