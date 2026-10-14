import { FREE_LIMITS } from '../../config';
import { loadHighlights } from '../../storage/highlights';
import { readJson, todayKey, writeJson } from '../../storage/json';
import { CardState, Highlight, ReviewGrade } from '../../types';
import { newCard, schedule } from './srs';

const KEY = 'epub:review:v1';

type ReviewData = {
  cards: Record<string, CardState>;
  days: Record<string, number>;
  lastStoreReviewPromptAt?: number;
  notificationsScheduled?: boolean;
};

const empty = (): ReviewData => ({ cards: {}, days: {} });

export async function loadReviewData(): Promise<ReviewData> {
  const data = await readJson<ReviewData>(KEY, empty());
  return { ...empty(), ...data };
}

export const saveReviewData = (data: ReviewData) => writeJson(KEY, data);

export type ReviewItem = { highlight: Highlight; card: CardState };

export type ReviewQueue = {
  due: ReviewItem[];
  reviewedToday: number;
  remainingFreeToday: number;
  lockedByLimit: boolean;
  lockedBooks: number; // libros excluidos en plan gratis
  streak: number;
  totalCards: number;
};

/** Libro habilitado para repaso gratis: el del primer subrayado. */
const freeBookIds = (highlights: Highlight[]) => {
  const ordered = [...highlights].sort((a, b) => a.createdAt - b.createdAt);
  const ids: string[] = [];
  for (const item of ordered) {
    if (!ids.includes(item.bookId)) ids.push(item.bookId);
    if (ids.length >= FREE_LIMITS.reviewBooks) break;
  }
  return ids;
};

export function computeStreak(days: Record<string, number>, now = new Date()) {
  let streak = 0;
  const cursor = new Date(now);
  if (!days[todayKey(cursor)]) cursor.setDate(cursor.getDate() - 1);
  while (days[todayKey(cursor)]) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export async function buildQueue(isPro: boolean, now = Date.now()): Promise<ReviewQueue> {
  const [highlights, data] = await Promise.all([loadHighlights(), loadReviewData()]);
  const allowedBooks = isPro ? null : freeBookIds(highlights);
  const eligible = highlights.filter((item) => !allowedBooks || allowedBooks.includes(item.bookId));
  const lockedBooks =
    new Set(highlights.map((item) => item.bookId)).size - new Set(eligible.map((i) => i.bookId)).size;

  const due = eligible
    .map((highlight) => ({
      highlight,
      card: data.cards[highlight.id] ?? newCard(highlight.id, highlight.createdAt),
    }))
    .filter((item) => item.card.due <= now)
    .sort((a, b) => a.card.due - b.card.due);

  const reviewedToday = data.days[todayKey(new Date(now))] ?? 0;
  const remainingFreeToday = Math.max(0, FREE_LIMITS.dailyReviews - reviewedToday);

  return {
    due: isPro ? due : due.slice(0, remainingFreeToday),
    reviewedToday,
    remainingFreeToday,
    lockedByLimit: !isPro && remainingFreeToday === 0 && due.length > 0,
    lockedBooks: Math.max(0, lockedBooks),
    streak: computeStreak(data.days, new Date(now)),
    totalCards: highlights.length,
  };
}

export async function gradeCard(item: ReviewItem, grade: ReviewGrade, now = Date.now()) {
  const data = await loadReviewData();
  data.cards[item.highlight.id] = schedule(item.card, grade, now);
  const key = todayKey(new Date(now));
  data.days[key] = (data.days[key] ?? 0) + 1;
  await saveReviewData(data);
  return data;
}

export async function dueCountForBadge(isPro: boolean) {
  const queue = await buildQueue(isPro);
  return queue.due.length;
}
