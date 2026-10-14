import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { FALLBACK_PRICES } from '../config';
import { track } from '../services/analytics';
import { getPlans, PlanOption, proStore, purchase, restorePurchases } from '../services/purchases';
import { joinWaitlist, supabaseEnabled } from '../services/supabase';
import { useStore } from '../state/store';
import { Button, Card, colors, kit, ScreenHeader } from '../ui/kit';

type Props = { source: string; onClose: () => void };

const BENEFITS = [
  'Repaso espaciado ilimitado, de todos tus libros',
  'Resumenes de capitulo con IA',
  'Exportar a Notion, Obsidian (Markdown) y Anki',
  'Respaldo en la nube y sincronizacion',
  'Estadisticas completas y racha',
];

const FAKE_PLANS = [
  { kind: 'annual', title: 'Anual', price: FALLBACK_PRICES.annual, badge: '7 dias gratis · ahorra 44%' },
  { kind: 'monthly', title: 'Mensual', price: FALLBACK_PRICES.monthly, badge: '' },
  { kind: 'lifetime', title: 'De por vida', price: FALLBACK_PRICES.lifetime, badge: 'Solo lanzamiento' },
] as const;

export function PaywallScreen({ source, onClose }: Props) {
  const { isPro, purchasesAvailable } = useStore(proStore);
  const [plans, setPlans] = useState<PlanOption[] | null>(null);
  const [selected, setSelected] = useState<string>('annual');
  const [busy, setBusy] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [email, setEmail] = useState('');

  useEffect(() => {
    track('paywall_viewed', { source, purchases_available: purchasesAvailable });
    void getPlans().then((result) => {
      setPlans(result);
      const annual = result.find((plan) => plan.kind === 'annual');
      if (annual) setSelected(annual.id);
    });
  }, [purchasesAvailable, source]);

  const realPlans = plans && plans.length > 0;

  const onContinue = async () => {
    track('paywall_cta_tapped', { source, plan: selected, real: Boolean(realPlans) });
    if (realPlans) {
      const plan = plans!.find((item) => item.id === selected);
      if (!plan) return;
      setBusy(true);
      const ok = await purchase(plan);
      setBusy(false);
      if (ok) {
        Alert.alert('¡Bienvenido a Pro!', 'Ya tienes acceso a todas las funciones.');
        onClose();
      }
      return;
    }
    // Fake door: medimos intencion de pago antes de habilitar cobros.
    setWaitlistOpen(true);
  };

  const submitWaitlist = async () => {
    const value = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      Alert.alert('Correo no valido', 'Revisa el correo e intenta de nuevo.');
      return;
    }
    setBusy(true);
    track('waitlist_joined', { source, plan: selected });
    try {
      if (supabaseEnabled()) await joinWaitlist(value, `${source}:${selected}`);
    } catch {
      // El evento de analytics ya registro la intencion.
    }
    setBusy(false);
    Alert.alert('¡Gracias!', 'Te avisaremos cuando Pro este disponible, con el precio de lanzamiento.');
    onClose();
  };

  if (isPro) {
    return (
      <View style={kit.screen}>
        <ScreenHeader title="Pro" onBack={onClose} />
        <View style={kit.content}>
          <Card>
            <Text style={kit.subtitle}>Ya eres Pro ✓</Text>
            <Text style={kit.body}>Gracias por apoyar el proyecto.</Text>
          </Card>
        </View>
      </View>
    );
  }

  return (
    <View style={kit.screen}>
      <ScreenHeader title="Lector Pro" onBack={onClose} />
      <ScrollView contentContainerStyle={kit.content}>
        <Text style={kit.title}>Recuerda lo que lees</Text>
        <Text style={kit.body}>
          Leer y subrayar siempre es gratis. Pro convierte tus subrayados en conocimiento.
        </Text>
        <Card>
          {BENEFITS.map((benefit) => (
            <Text key={benefit} style={kit.body}>
              ✓ {benefit}
            </Text>
          ))}
        </Card>

        {plans === null ? (
          <ActivityIndicator color={colors.ink} />
        ) : (
          <View style={{ gap: 8 }}>
            {(realPlans
              ? plans!.map((plan) => ({
                  id: plan.id,
                  title: plan.title,
                  price: plan.price,
                  badge: plan.kind === 'annual' ? 'Mejor precio' : '',
                }))
              : FAKE_PLANS.map((plan) => ({
                  id: plan.kind as string,
                  title: plan.title,
                  price: plan.price,
                  badge: plan.badge,
                }))
            ).map((plan) => (
              <TouchableOpacity
                key={plan.id}
                onPress={() => setSelected(plan.id)}
                style={[
                  kit.card,
                  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
                  selected === plan.id && { borderColor: colors.accent, borderWidth: 2 },
                ]}
              >
                <View style={{ gap: 2 }}>
                  <Text style={kit.subtitle}>{plan.title}</Text>
                  {plan.badge ? <Text style={kit.muted}>{plan.badge}</Text> : null}
                </View>
                <Text style={kit.subtitle}>{plan.price}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {waitlistOpen ? (
          <Card>
            <Text style={kit.subtitle}>Pro llega muy pronto</Text>
            <Text style={kit.body}>
              Dejanos tu correo y te avisamos con el precio de lanzamiento. No cobramos nada ahora.
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
            <Button label="Avisarme" onPress={() => void submitWaitlist()} loading={busy} />
          </Card>
        ) : (
          <Button label="Continuar" onPress={() => void onContinue()} loading={busy} />
        )}

        {purchasesAvailable && (
          <Button
            label="Restaurar compras"
            variant="ghost"
            onPress={async () => {
              const ok = await restorePurchases();
              Alert.alert(
                ok ? 'Compras restauradas' : 'Sin compras',
                ok ? 'Pro esta activo.' : 'No encontramos compras de Pro.',
              );
            }}
          />
        )}
        <Text style={kit.muted}>
          La suscripcion se renueva automaticamente y puedes cancelarla en la tienda en cualquier momento.
        </Text>
      </ScrollView>
    </View>
  );
}
