// Reporte de errores minimo: envia excepciones a PostHog ($exception).
// Puede reemplazarse por Sentry (@sentry/react-native) sin cambiar los llamados.
import { flush, track } from './analytics';

type GlobalErrorUtils = {
  getGlobalHandler: () => (error: Error, isFatal?: boolean) => void;
  setGlobalHandler: (handler: (error: Error, isFatal?: boolean) => void) => void;
};

export function captureException(error: unknown, context: Record<string, unknown> = {}) {
  const err = error instanceof Error ? error : new Error(String(error));
  track('$exception', {
    $exception_type: err.name,
    $exception_message: err.message,
    $exception_stack_trace_raw: err.stack?.slice(0, 4000),
    ...context,
  });
}

let installed = false;

export function installCrashReporting() {
  if (installed) return;
  installed = true;
  const errorUtils = (globalThis as unknown as { ErrorUtils?: GlobalErrorUtils }).ErrorUtils;
  if (!errorUtils) return;
  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    captureException(error, { fatal: Boolean(isFatal) });
    void flush().finally(() => previous(error, isFatal));
  });
}
