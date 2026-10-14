// Componentes y estilos compartidos de las pantallas nuevas (Fase 2).
import { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';

export const colors = {
  bg: '#f5f1e8',
  surface: '#fffdf8',
  border: '#dfd4c0',
  ink: '#352c21',
  inkSoft: '#6b5f4f',
  accent: '#111827',
  accentInk: '#ffffff',
  highlight: '#f2c94c',
  good: '#2f6f4f',
  danger: '#8a2f2f',
};

export function ScreenHeader({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  return (
    <View style={kit.header}>
      {onBack ? (
        <TouchableOpacity onPress={onBack} style={kit.backButton} accessibilityLabel="Volver">
          <Text style={kit.backText}>‹ Volver</Text>
        </TouchableOpacity>
      ) : (
        <View style={kit.backButton} />
      )}
      <Text style={kit.headerTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={kit.headerRight}>{right}</View>
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const isPrimary = variant === 'primary';
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      style={[
        kit.button,
        isPrimary ? kit.buttonPrimary : variant === 'secondary' ? kit.buttonSecondary : kit.buttonGhost,
        (disabled || loading) && kit.buttonDisabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.accentInk : colors.ink} />
      ) : (
        <Text style={[kit.buttonText, isPrimary && kit.buttonTextPrimary]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[kit.card, style]}>{children}</View>;
}

export const kit = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 14, paddingBottom: 48 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#efe8da',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: { minWidth: 80, paddingVertical: 6 },
  backText: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  headerTitle: { flex: 1, textAlign: 'center', color: colors.ink, fontSize: 17, fontWeight: '700' },
  headerRight: { minWidth: 80, alignItems: 'flex-end' },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 14,
    gap: 8,
  },
  title: { color: colors.ink, fontSize: 20, fontWeight: '700' },
  subtitle: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  body: { color: colors.ink, fontSize: 15, lineHeight: 22 },
  muted: { color: colors.inkSoft, fontSize: 13, lineHeight: 19 },
  quote: {
    color: colors.ink,
    fontSize: 17,
    lineHeight: 26,
    fontFamily: 'Georgia',
    borderLeftWidth: 3,
    borderLeftColor: colors.highlight,
    paddingLeft: 12,
  },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  button: {
    minHeight: 46,
    borderRadius: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  buttonGhost: { backgroundColor: 'transparent' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  buttonTextPrimary: { color: colors.accentInk },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
  },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#f7e5cc',
  },
  pillText: { color: colors.ink, fontSize: 12, fontWeight: '700' },
});
