// Pide resena en un momento de satisfaccion: tras completar un repaso con racha.
import * as StoreReview from 'expo-store-review';
import { loadReviewData, saveReviewData } from '../features/review/reviewStore';
import { track } from './analytics';

const MIN_DAYS_BETWEEN = 90;

export async function maybeAskForReview(context: { cardsReviewed: number; streak: number }) {
  if (context.cardsReviewed < 5 || context.streak < 3) return;
  const data = await loadReviewData();
  const last = data.lastStoreReviewPromptAt ?? 0;
  if (Date.now() - last < MIN_DAYS_BETWEEN * 24 * 60 * 60 * 1000) return;
  try {
    if (!(await StoreReview.isAvailableAsync()) || !(await StoreReview.hasAction())) return;
    await saveReviewData({ ...data, lastStoreReviewPromptAt: Date.now() });
    track('store_review_prompted', context);
    await StoreReview.requestReview();
  } catch {
    // no critico
  }
}
