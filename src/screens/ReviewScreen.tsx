import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { FREE_LIMITS } from '../config';
import { describeInterval } from '../features/review/srs';
import { buildQueue, gradeCard, loadReviewData, ReviewQueue } from '../features/review/reviewStore';
import { enableDailyReminder } from '../features/review/notifications';
import { track } from '../services/analytics';
import { maybeAskForReview } from '../services/storeReview';
import { ReviewGrade } from '../types';
import { Button, Card, colors, kit, ScreenHeader } from '../ui/kit';

type Props = {
  isPro: boolean;
  onBack: () => void;
  onOpenPaywall: (source: string) => void;
};

const GRADES: { grade: ReviewGrade; label: string; color: string }[] = [
  { grade: 'again', label: 'Olvide', color: '#8a2f2f' },
  { grade: 'hard', label: 'Dificil', color: '#7a5b2f' },
  { grade: 'good', label: 'Bien', color: '#2f6f4f' },
  { grade: 'easy', label: 'Facil', color: '#3f5d57' },
];

export function ReviewScreen({ isPro, onBack, onOpenPaywall }: Props) {
  const [queue, setQueue] = useState<ReviewQueue | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [reviewedNow, setReviewedNow] = useState(0);
  const [reminderOn, setReminderOn] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    const [nextQueue, data] = await Promise.all([buildQueue(isPro), loadReviewData()]);
    setQueue(nextQueue);
    setReminderOn(Boolean(data.notificationsScheduled));
    setIndex(0);
    setRevealed(false);
  }, [isPro]);

  useEffect(() => {
    void load();
    track('review_opened', { is_pro: isPro });
  }, [isPro, load]);

  const current = queue?.due[index];
  const finished = Boolean(queue) && !current;

  useEffect(() => {
    if (!finished || reviewedNow === 0) return;
    void (async () => {
      const fresh = await buildQueue(isPro);
      track('review_session_completed', { cards: reviewedNow, streak: fresh.streak });
      setQueue((prev) =>
        prev ? { ...prev, streak: fresh.streak, lockedByLimit: fresh.lockedByLimit } : prev,
      );
      await maybeAskForReview({ cardsReviewed: reviewedNow, streak: fresh.streak });
    })();
  }, [finished, isPro, reviewedNow]);

  const grade = async (value: ReviewGrade) => {
    if (!current) return;
    await gradeCard(current, value);
    track('review_card_rated', { grade: value, reps: current.card.reps });
    setReviewedNow((n) => n + 1);
    setRevealed(false);
    setIndex((i) => i + 1);
  };

  if (!queue) {
    return (
      <View style={kit.screen}>
        <ScreenHeader title="Repaso" onBack={onBack} />
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.ink} />
      </View>
    );
  }

  return (
    <View style={kit.screen}>
      <ScreenHeader
        title="Repaso de hoy"
        onBack={onBack}
        right={<Text style={kit.muted}>{queue.streak > 0 ? `🔥 ${queue.streak}` : ''}</Text>}
      />
      <ScrollView contentContainerStyle={kit.content}>
        {queue.totalCards === 0 ? (
          <Card>
            <Text style={kit.subtitle}>Aun no tienes tarjetas</Text>
            <Text style={kit.body}>
              Abre un libro, manten presionado un pasaje y toca “Subrayar”. Cada subrayado se convierte en una
              tarjeta que te mostramos justo antes de que la olvides.
            </Text>
            <Button label="Ir a la biblioteca" onPress={onBack} />
          </Card>
        ) : current ? (
          <>
            <View style={kit.row}>
              <View style={kit.pill}>
                <Text style={kit.pillText}>
                  {index + 1} de {queue.due.length}
                </Text>
              </View>
              {!isPro && (
                <Text style={kit.muted}>
                  Plan gratis: {Math.max(0, queue.remainingFreeToday - reviewedNow)} de{' '}
                  {FREE_LIMITS.dailyReviews} hoy
                </Text>
              )}
            </View>
            <Card>
              <Text style={kit.muted}>
                {current.highlight.bookTitle}
                {current.highlight.chapter ? ` · ${current.highlight.chapter}` : ''}
              </Text>
              {current.highlight.note ? (
                <Text style={kit.subtitle}>{current.highlight.note}</Text>
              ) : (
                <Text style={kit.subtitle}>¿Recuerdas la idea de este pasaje?</Text>
              )}
              {revealed ? (
                <Text style={kit.quote}>{current.highlight.text}</Text>
              ) : (
                <Button label="Mostrar pasaje" variant="secondary" onPress={() => setRevealed(true)} />
              )}
            </Card>
            {revealed && (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {GRADES.map((item) => (
                  <TouchableOpacity
                    key={item.grade}
                    onPress={() => void grade(item.grade)}
                    style={{
                      flex: 1,
                      borderRadius: 12,
                      backgroundColor: item.color,
                      paddingVertical: 10,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700' }}>{item.label}</Text>
                    <Text style={{ color: '#f7e5cc', fontSize: 11 }}>
                      {describeInterval(current.card, item.grade)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        ) : (
          <Card>
            <Text style={kit.subtitle}>
              {reviewedNow > 0
                ? `¡Listo! Repasaste ${reviewedNow} ${reviewedNow === 1 ? 'tarjeta' : 'tarjetas'}`
                : 'Estas al dia'}
            </Text>
            <Text style={kit.body}>
              {queue.streak > 0
                ? `Llevas ${queue.streak} ${queue.streak === 1 ? 'dia' : 'dias'} seguidos repasando.`
                : 'Vuelve manana para mantener tu racha.'}
            </Text>
            {reminderOn === false && (
              <Button
                label="Recordarme cada dia a las 8 p. m."
                variant="secondary"
                onPress={async () => setReminderOn(await enableDailyReminder())}
              />
            )}
            <Button label="Volver a la biblioteca" onPress={onBack} />
          </Card>
        )}

        {!isPro && (queue.lockedByLimit || (finished && queue.remainingFreeToday - reviewedNow <= 0)) && (
          <Card>
            <Text style={kit.subtitle}>Llegaste al limite gratis de hoy</Text>
            <Text style={kit.body}>Con Pro repasas sin limite y todos tus libros.</Text>
            <Button label="Ver Pro" onPress={() => onOpenPaywall('review_limit')} />
          </Card>
        )}
        {!isPro && queue.lockedBooks > 0 && (
          <Card>
            <Text style={kit.body}>
              Tienes {queue.lockedBooks} {queue.lockedBooks === 1 ? 'libro mas' : 'libros mas'} con
              subrayados. El plan gratis repasa un libro; Pro los incluye todos.
            </Text>
            <Button
              label="Desbloquear todos"
              variant="secondary"
              onPress={() => onOpenPaywall('review_books')}
            />
          </Card>
        )}
      </ScrollView>
    </View>
  );
}
