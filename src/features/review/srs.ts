// Repaso espaciado basado en SM-2 (version simplificada).
import { CardState, ReviewGrade } from '../../types';

const DAY = 24 * 60 * 60 * 1000;
const MIN_EASE = 1.3;

export const newCard = (id: string, due = Date.now()): CardState => ({
  id,
  ease: 2.5,
  intervalDays: 0,
  reps: 0,
  lapses: 0,
  due,
});

export function schedule(card: CardState, grade: ReviewGrade, now = Date.now()): CardState {
  let { ease, intervalDays, reps, lapses } = card;

  if (grade === 'again') {
    return {
      ...card,
      ease: Math.max(MIN_EASE, ease - 0.2),
      intervalDays: 0,
      reps: 0,
      lapses: lapses + 1,
      due: now + 10 * 60 * 1000,
      lastReviewedAt: now,
    };
  }

  if (grade === 'hard') {
    intervalDays = reps === 0 ? 1 : Math.max(1, Math.round(intervalDays * 1.2));
    ease = Math.max(MIN_EASE, ease - 0.15);
  } else if (grade === 'good') {
    intervalDays = reps === 0 ? 1 : reps === 1 ? 3 : Math.round(intervalDays * ease);
  } else {
    intervalDays = reps === 0 ? 3 : Math.round(Math.max(intervalDays, 1) * ease * 1.3);
    ease += 0.15;
  }

  return {
    ...card,
    ease,
    intervalDays,
    reps: reps + 1,
    lapses,
    due: now + intervalDays * DAY,
    lastReviewedAt: now,
  };
}

export const describeInterval = (card: CardState, grade: ReviewGrade) => {
  const next = schedule(card, grade, 0);
  if (next.intervalDays === 0) return '10 min';
  if (next.intervalDays === 1) return '1 dia';
  if (next.intervalDays < 30) return `${next.intervalDays} dias`;
  return `${Math.round(next.intervalDays / 30)} meses`;
};
