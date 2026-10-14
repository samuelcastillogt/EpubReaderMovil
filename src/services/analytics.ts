// Analytics minimo sobre la API de captura de PostHog (sin SDK nativo).
// Sin EXPO_PUBLIC_POSTHOG_KEY todo es no-op.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { config } from '../config';
import { newId } from '../storage/json';

type Props = Record<string, unknown>;
type QueuedEvent = { event: string; properties: Props; timestamp: string };

const DISTINCT_ID_KEY = 'analytics:distinctId:v1';
const FIRST_OPEN_KEY = 'analytics:firstOpenAt:v1';
const FLUSH_INTERVAL_MS = 15000;
const MAX_BATCH = 30;

let distinctId: string | null = null;
let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let sessionStartedAt: number | null = null;
let superProps: Props = {};

const enabled = () => Boolean(config.posthogKey);

export async function initAnalytics(appVersion: string) {
  distinctId = (await AsyncStorage.getItem(DISTINCT_ID_KEY)) || null;
  if (!distinctId) {
    distinctId = newId();
    await AsyncStorage.setItem(DISTINCT_ID_KEY, distinctId);
  }
  superProps = { $os: Platform.OS, app_version: appVersion };

  const firstOpen = await AsyncStorage.getItem(FIRST_OPEN_KEY);
  if (!firstOpen) {
    await AsyncStorage.setItem(FIRST_OPEN_KEY, String(Date.now()));
    track('install');
  }
  startSession();

  if (!flushTimer) flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  AppState.addEventListener('change', onAppStateChange);
}

export function getDistinctId() {
  return distinctId;
}

export function identify(userId: string, props: Props = {}) {
  if (!distinctId) return;
  track('$identify', { $anon_distinct_id: distinctId, $set: props, distinct_id_override: userId });
}

export function track(event: string, properties: Props = {}) {
  queue.push({
    event,
    properties: { ...superProps, ...properties },
    timestamp: new Date().toISOString(),
  });
  if (queue.length >= MAX_BATCH) void flush();
}

export async function flush() {
  if (!enabled() || !distinctId || queue.length === 0) {
    if (!enabled()) queue = [];
    return;
  }
  const batch = queue.slice(0, MAX_BATCH);
  queue = queue.slice(MAX_BATCH);
  try {
    await fetch(`${config.posthogHost.replace(/\/$/, '')}/batch/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: config.posthogKey,
        batch: batch.map((item) => {
          const { distinct_id_override, ...rest } = item.properties as Props & {
            distinct_id_override?: string;
          };
          return {
            event: item.event,
            distinct_id: distinct_id_override || distinctId,
            properties: rest,
            timestamp: item.timestamp,
          };
        }),
      }),
    });
  } catch {
    // Sin red: se reintenta en el siguiente ciclo.
    queue = [...batch, ...queue].slice(-500);
  }
}

function startSession() {
  if (sessionStartedAt) return;
  sessionStartedAt = Date.now();
  track('session_start');
}

function endSession() {
  if (!sessionStartedAt) return;
  track('session_end', { duration_s: Math.round((Date.now() - sessionStartedAt) / 1000) });
  sessionStartedAt = null;
  void flush();
}

function onAppStateChange(state: AppStateStatus) {
  if (state === 'active') startSession();
  else if (state === 'background') endSession();
}
