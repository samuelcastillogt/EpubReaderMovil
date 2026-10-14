// Compras in-app con RevenueCat. Sin claves, la app queda en modo "lista de espera"
// (fake door) para validar disposicion de pago antes de cobrar.
import { Platform } from 'react-native';
import Purchases, { CustomerInfo, PurchasesPackage } from 'react-native-purchases';
import { config, PRO_ENTITLEMENT } from '../config';
import { createStore } from '../state/store';
import { track } from './analytics';
import { captureException } from './crash';

export type PlanOption = {
  id: string;
  kind: 'monthly' | 'annual' | 'lifetime' | 'other';
  title: string;
  price: string;
  pkg: PurchasesPackage;
};

export const proStore = createStore({
  isPro: config.forcePro,
  purchasesAvailable: false,
});

const apiKey = () => (Platform.OS === 'ios' ? config.revenueCatIosKey : config.revenueCatAndroidKey);

const applyCustomerInfo = (info: CustomerInfo) => {
  const active = Boolean(info.entitlements.active[PRO_ENTITLEMENT]);
  proStore.set({ isPro: config.forcePro || active });
};

export async function initPurchases(appUserId?: string) {
  const key = apiKey();
  if (!key) return;
  try {
    Purchases.configure({ apiKey: key, appUserID: appUserId });
    proStore.set({ purchasesAvailable: true });
    Purchases.addCustomerInfoUpdateListener(applyCustomerInfo);
    applyCustomerInfo(await Purchases.getCustomerInfo());
  } catch (error) {
    captureException(error, { where: 'initPurchases' });
  }
}

export async function linkPurchasesUser(userId: string) {
  if (!proStore.get().purchasesAvailable) return;
  try {
    const { customerInfo } = await Purchases.logIn(userId);
    applyCustomerInfo(customerInfo);
  } catch (error) {
    captureException(error, { where: 'linkPurchasesUser' });
  }
}

export async function getPlans(): Promise<PlanOption[]> {
  if (!proStore.get().purchasesAvailable) return [];
  try {
    const offerings = await Purchases.getOfferings();
    const packages = offerings.current?.availablePackages ?? [];
    return packages.map((pkg) => {
      const type = String(pkg.packageType);
      const kind: PlanOption['kind'] =
        type === 'MONTHLY'
          ? 'monthly'
          : type === 'ANNUAL'
            ? 'annual'
            : type === 'LIFETIME'
              ? 'lifetime'
              : 'other';
      const title =
        kind === 'monthly'
          ? 'Mensual'
          : kind === 'annual'
            ? 'Anual'
            : kind === 'lifetime'
              ? 'De por vida'
              : pkg.product.title;
      return { id: pkg.identifier, kind, title, price: pkg.product.priceString, pkg };
    });
  } catch (error) {
    captureException(error, { where: 'getPlans' });
    return [];
  }
}

export async function purchase(plan: PlanOption): Promise<boolean> {
  track('purchase_started', { plan: plan.kind });
  try {
    const { customerInfo } = await Purchases.purchasePackage(plan.pkg);
    applyCustomerInfo(customerInfo);
    const ok = proStore.get().isPro;
    track(ok ? 'purchase_completed' : 'purchase_pending', { plan: plan.kind });
    return ok;
  } catch (error) {
    const cancelled = Boolean((error as { userCancelled?: boolean })?.userCancelled);
    track(cancelled ? 'purchase_cancelled' : 'purchase_failed', { plan: plan.kind });
    if (!cancelled) captureException(error, { where: 'purchase' });
    return false;
  }
}

export async function restorePurchases(): Promise<boolean> {
  if (!proStore.get().purchasesAvailable) return false;
  try {
    applyCustomerInfo(await Purchases.restorePurchases());
    track('purchase_restored', { is_pro: proStore.get().isPro });
    return proStore.get().isPro;
  } catch (error) {
    captureException(error, { where: 'restorePurchases' });
    return false;
  }
}
