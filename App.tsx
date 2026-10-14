import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useEffect, useState } from 'react';
import { Alert, BackHandler, SafeAreaView, View } from 'react-native';
import appConfig from './app.json';
import { buildQueue } from './src/features/review/reviewStore';
import { flush, identify, initAnalytics, track } from './src/services/analytics';
import { captureException, installCrashReporting } from './src/services/crash';
import { initPurchases, proStore } from './src/services/purchases';
import { ensureSession, restoreSession, supabaseEnabled } from './src/services/supabase';
import { onHighlightsChanged } from './src/storage/highlights';
import { loadLibrary, persistPickedBook, saveLibrary } from './src/storage/library';
import { useStore } from './src/state/store';
import { AccountScreen } from './src/screens/AccountScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { NotesScreen } from './src/screens/NotesScreen';
import { PaywallScreen } from './src/screens/PaywallScreen';
import { ReaderScreen } from './src/screens/ReaderScreen';
import { ReviewScreen } from './src/screens/ReviewScreen';
import { LibraryBook, Screen } from './src/types';
import { ErrorBoundary } from './src/ui/ErrorBoundary';
import { styles } from './src/ui/styles';

installCrashReporting();

export default function App() {
  return (
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  );
}

function Root() {
  const { isPro } = useStore(proStore);
  const [stack, setStack] = useState<Screen[]>([{ name: 'library' }]);
  const [library, setLibrary] = useState<LibraryBook[]>([]);
  const [isPickingFile, setIsPickingFile] = useState(false);
  const [dueCount, setDueCount] = useState(0);
  const [streak, setStreak] = useState(0);

  const screen = stack[stack.length - 1];
  const readerEntry = stack.find(
    (entry): entry is Extract<Screen, { name: 'reader' }> => entry.name === 'reader',
  );
  const push = useCallback((next: Screen) => setStack((prev) => [...prev, next]), []);
  const pop = useCallback(() => setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev)), []);

  // Arranque: analytics, sesion, compras y biblioteca.
  useEffect(() => {
    void (async () => {
      await initAnalytics(appConfig.expo.version);
      // Con Supabase activo siempre hay sesion (anonima si hace falta) para que el ID de compras
      // de RevenueCat coincida con el usuario del backend.
      const session = supabaseEnabled()
        ? ((await restoreSession()) ?? (await ensureSession().catch(() => null)))
        : null;
      if (session && !session.isAnonymous) identify(session.userId, { email: session.email });
      await initPurchases(session?.userId);
      setLibrary(await loadLibrary());
      track('app_open', { is_pro: proStore.get().isPro });
    })().catch((error) => captureException(error, { where: 'boot' }));
    return () => {
      void flush();
    };
  }, []);

  const refreshReviewBadge = useCallback(async () => {
    const queue = await buildQueue(proStore.get().isPro);
    setDueCount(queue.due.length);
    setStreak(queue.streak);
  }, []);

  useEffect(() => {
    if (screen.name === 'library') void refreshReviewBadge();
  }, [isPro, refreshReviewBadge, screen.name]);

  useEffect(() => {
    const unsubscribe = onHighlightsChanged(() => void refreshReviewBadge());
    return () => {
      unsubscribe();
    };
  }, [refreshReviewBadge]);

  // Boton atras de Android navega dentro de la app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 1) {
        pop();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [pop, stack.length]);

  const persistLibrary = useCallback(async (next: LibraryBook[]) => {
    setLibrary(next);
    await saveLibrary(next);
  }, []);

  const patchLibraryBook = useCallback((id: string, patch: Partial<LibraryBook>) => {
    setLibrary((prev) => {
      const next = prev.map((book) => (book.id === id ? { ...book, ...patch } : book));
      saveLibrary(next).catch(() => undefined);
      return next;
    });
  }, []);

  const openBook = useCallback(
    async (entry: LibraryBook) => {
      const updated = { ...entry, lastOpenedAt: Date.now() };
      await persistLibrary([updated, ...library.filter((book) => book.id !== entry.id)].slice(0, 30));
      push({ name: 'reader', book: updated });
    },
    [library, persistLibrary, push],
  );

  const pickEpubFile = useCallback(async () => {
    try {
      setIsPickingFile(true);
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/epub+zip',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || result.assets.length === 0) return;
      const entry = await persistPickedBook(result.assets[0]);
      track('import_book', {
        size_kb: Math.round((result.assets[0].size || 0) / 1024),
        library_size: library.length + 1,
      });
      await openBook(entry);
    } catch (error) {
      captureException(error, { where: 'pickEpubFile' });
      Alert.alert('Error', error instanceof Error ? error.message : 'No se pudo seleccionar el archivo');
    } finally {
      setIsPickingFile(false);
    }
  }, [library.length, openBook]);

  const openPaywall = useCallback((source: string) => push({ name: 'paywall', source }), [push]);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      {screen.name === 'library' && (
        <LibraryScreen
          library={library}
          isPickingFile={isPickingFile}
          isPro={isPro}
          dueCount={dueCount}
          streak={streak}
          onOpenBook={(book) => void openBook(book)}
          onPickFile={() => void pickEpubFile()}
          onOpenReview={() => push({ name: 'review' })}
          onOpenAccount={() => push({ name: 'account' })}
        />
      )}
      {readerEntry && (
        // El lector queda montado (oculto) mientras se ven notas o Pro, para no recargar el libro.
        <View style={{ flex: 1, display: screen.name === 'reader' ? 'flex' : 'none' }}>
          <ReaderScreen
            key={readerEntry.book.id}
            book={readerEntry.book}
            isPro={isPro}
            onExit={pop}
            onPatchBook={patchLibraryBook}
            onOpenNotes={(bookId, bookTitle) => push({ name: 'notes', bookId, bookTitle })}
            onOpenPaywall={openPaywall}
          />
        </View>
      )}
      {screen.name === 'review' && <ReviewScreen isPro={isPro} onBack={pop} onOpenPaywall={openPaywall} />}
      {screen.name === 'notes' && (
        <NotesScreen
          bookId={screen.bookId}
          bookTitle={screen.bookTitle}
          isPro={isPro}
          onBack={pop}
          onOpenPaywall={openPaywall}
        />
      )}
      {screen.name === 'paywall' && <PaywallScreen source={screen.source} onClose={pop} />}
      {screen.name === 'account' && <AccountScreen onBack={pop} onOpenPaywall={openPaywall} />}
    </SafeAreaView>
  );
}
