import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { backupNow, restoreFromBackup } from '../features/backup';
import { disableDailyReminder, enableDailyReminder } from '../features/review/notifications';
import { loadReviewData } from '../features/review/reviewStore';
import { identify } from '../services/analytics';
import { linkPurchasesUser, proStore, restorePurchases } from '../services/purchases';
import { accountStore, sendEmailCode, signOut, supabaseEnabled, verifyEmailCode } from '../services/supabase';
import { useStore } from '../state/store';
import { Button, Card, kit, ScreenHeader } from '../ui/kit';

type Props = { onBack: () => void; onOpenPaywall: (source: string) => void };

export function AccountScreen({ onBack, onOpenPaywall }: Props) {
  const { isPro, purchasesAvailable } = useStore(proStore);
  const { session } = useStore(accountStore);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [reminderOn, setReminderOn] = useState(false);

  useEffect(() => {
    void loadReviewData().then((data) => setReminderOn(Boolean(data.notificationsScheduled)));
  }, []);

  const run = async (key: string, task: () => Promise<void>) => {
    setBusy(key);
    try {
      await task();
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Algo salio mal.');
    } finally {
      setBusy(null);
    }
  };

  const signedInWithEmail = Boolean(session?.email && !session.isAnonymous);

  return (
    <View style={kit.screen}>
      <ScreenHeader title="Cuenta" onBack={onBack} />
      <ScrollView contentContainerStyle={kit.content}>
        <Card>
          <Text style={kit.subtitle}>{isPro ? 'Lector Pro ✓' : 'Plan gratis'}</Text>
          <Text style={kit.muted}>
            {isPro
              ? 'Repaso ilimitado, resumenes IA, exportacion y respaldo activos.'
              : '10 tarjetas al dia de un libro, 1 resumen por libro.'}
          </Text>
          {!isPro && <Button label="Ver Pro" onPress={() => onOpenPaywall('account')} />}
          {purchasesAvailable && (
            <Button
              label="Restaurar compras"
              variant="ghost"
              onPress={() => void run('restore', async () => void (await restorePurchases()))}
              loading={busy === 'restore'}
            />
          )}
        </Card>

        <Card>
          <Text style={kit.subtitle}>Recordatorio diario</Text>
          <Text style={kit.muted}>Una notificacion a las 8 p. m. para tu repaso de 5 minutos.</Text>
          <Button
            label={reminderOn ? 'Desactivar recordatorio' : 'Activar recordatorio'}
            variant="secondary"
            onPress={() =>
              void run('reminder', async () => {
                if (reminderOn) {
                  await disableDailyReminder();
                  setReminderOn(false);
                } else {
                  setReminderOn(await enableDailyReminder());
                }
              })
            }
            loading={busy === 'reminder'}
          />
        </Card>

        <Card>
          <Text style={kit.subtitle}>Respaldo en la nube{isPro ? '' : ' · Pro'}</Text>
          {!supabaseEnabled() ? (
            <Text style={kit.muted}>El respaldo aun no esta configurado en esta version.</Text>
          ) : signedInWithEmail ? (
            <>
              <Text style={kit.muted}>
                Conectado como {session?.email}. Se respaldan subrayados, notas, repaso y resumenes (no los
                archivos EPUB).
              </Text>
              <View style={kit.row}>
                <Button
                  label="Respaldar ahora"
                  style={{ flex: 1 }}
                  loading={busy === 'backup'}
                  onPress={() => {
                    if (!isPro) return onOpenPaywall('backup');
                    void run('backup', async () => {
                      await backupNow();
                      Alert.alert('Listo', 'Respaldo guardado.');
                    });
                  }}
                />
                <Button
                  label="Restaurar"
                  variant="secondary"
                  style={{ flex: 1 }}
                  loading={busy === 'restoreBackup'}
                  onPress={() => {
                    if (!isPro) return onOpenPaywall('backup_restore');
                    void run('restoreBackup', async () => {
                      const result = await restoreFromBackup();
                      Alert.alert('Listo', `Se restauraron ${result.restored} subrayados.`);
                    });
                  }}
                />
              </View>
              <Button label="Cerrar sesion" variant="ghost" onPress={() => void signOut()} />
            </>
          ) : (
            <>
              <Text style={kit.muted}>
                Entra con tu correo para respaldar y recuperar tus notas en otro telefono.
              </Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="tu@correo.com"
                placeholderTextColor="#8b8172"
                keyboardType="email-address"
                autoCapitalize="none"
                style={kit.input}
              />
              {codeSent && (
                <TextInput
                  value={code}
                  onChangeText={setCode}
                  placeholder="Codigo de 6 digitos"
                  placeholderTextColor="#8b8172"
                  keyboardType="number-pad"
                  style={kit.input}
                />
              )}
              <Button
                label={codeSent ? 'Verificar codigo' : 'Enviarme un codigo'}
                loading={busy === 'auth'}
                onPress={() =>
                  void run('auth', async () => {
                    const value = email.trim().toLowerCase();
                    if (!codeSent) {
                      await sendEmailCode(value);
                      setCodeSent(true);
                      return;
                    }
                    const next = await verifyEmailCode(value, code.trim());
                    identify(next.userId, { email: next.email });
                    await linkPurchasesUser(next.userId);
                    setCodeSent(false);
                    setCode('');
                  })
                }
              />
            </>
          )}
        </Card>
      </ScrollView>
    </View>
  );
}
