// Configuracion por variables EXPO_PUBLIC_* (ver .env.example).
// Todo es opcional: si una clave falta, el servicio queda desactivado sin romper la app.
const env = (key: string) => {
  const value = process.env[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
};

export const config = {
  posthogKey: env('EXPO_PUBLIC_POSTHOG_KEY'),
  posthogHost: env('EXPO_PUBLIC_POSTHOG_HOST') ?? 'https://us.i.posthog.com',
  supabaseUrl: env('EXPO_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: env('EXPO_PUBLIC_SUPABASE_ANON_KEY'),
  revenueCatAndroidKey: env('EXPO_PUBLIC_RC_ANDROID_KEY'),
  revenueCatIosKey: env('EXPO_PUBLIC_RC_IOS_KEY'),
  // Solo para pruebas internas: fuerza el modo Pro sin compra.
  forcePro: env('EXPO_PUBLIC_FORCE_PRO') === '1',
};

export const FREE_LIMITS = {
  dailyReviews: 10,
  reviewBooks: 1,
  summariesPerBook: 1,
};

export const PRO_ENTITLEMENT = 'pro';

export const FALLBACK_PRICES = {
  monthly: 'US$2.99 / mes',
  annual: 'US$19.99 / año',
  lifetime: 'US$39.99 una vez',
};
