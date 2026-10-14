import { useSyncExternalStore } from 'react';

// Store minimo observable para estado global simple (Pro, cuenta).
export function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (patch: Partial<T>) => {
      state = { ...state, ...patch };
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStore<T>(store: ReturnType<typeof createStore<T>>) {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
