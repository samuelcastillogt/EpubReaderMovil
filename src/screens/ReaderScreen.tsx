import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { FREE_LIMITS } from '../config';
import { SummaryQuotaError, summarizeChapter } from '../features/ai/summaries';
import { READER_HTML } from '../reader/readerHtml';
import { track } from '../services/analytics';
import { captureException } from '../services/crash';
import {
  addHighlight,
  highlightsForBook,
  onHighlightsChanged,
  removeHighlight,
  updateHighlight,
} from '../storage/highlights';
import { newId } from '../storage/json';
import {
  clampSettings,
  loadPosition,
  loadReadingSettings,
  readBookBase64,
  saveReadingSettings,
  savePosition,
  DEFAULT_READING_SETTINGS,
} from '../storage/library';
import { loadSummaries } from '../storage/summaries';
import {
  ChapterSummary,
  Highlight,
  LibraryBook,
  ReaderEvent,
  ReaderTheme,
  ReadingSettings,
  SearchResult,
  TextSelection,
  TocItem,
  WebCommand,
} from '../types';
import { styles } from '../ui/styles';

type Panel = 'settings' | 'toc' | 'search' | 'study';

type Props = {
  book: LibraryBook;
  isPro: boolean;
  onExit: () => void;
  onPatchBook: (id: string, patch: Partial<LibraryBook>) => void;
  onOpenNotes: (bookId: string, bookTitle: string) => void;
  onOpenPaywall: (source: string) => void;
};

type NoteDraft = { selection?: TextSelection; highlight?: Highlight; text: string };
type SummaryState = { loading: boolean; summary?: ChapterSummary; error?: string };

export function ReaderScreen({ book, isPro, onExit, onPatchBook, onOpenNotes, onOpenPaywall }: Props) {
  const webViewRef = useRef<WebView>(null);
  const bookId = book.id;

  const [bookBase64, setBookBase64] = useState<string | null>(null);
  const [bookName, setBookName] = useState(book.title || book.name);
  const [startCfi, setStartCfi] = useState<string | null>(null);
  const [webReady, setWebReady] = useState(false);
  const [bookReady, setBookReady] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [readingSettings, setReadingSettings] = useState<ReadingSettings>(DEFAULT_READING_SETTINGS);
  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [activePanel, setActivePanel] = useState<Panel | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [progress, setProgress] = useState(book.progress || 0);
  const [statusText, setStatusText] = useState('Cargando EPUB...');
  const [flash, setFlash] = useState<string | null>(null);
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [currentChapter, setCurrentChapter] = useState<string | undefined>();
  const [summaryState, setSummaryState] = useState<SummaryState | null>(null);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSummaryRef = useRef<string | null>(null);
  const openedAtRef = useRef(Date.now());

  const sendCommand = useCallback((command: WebCommand) => {
    webViewRef.current?.postMessage(JSON.stringify(command));
  }, []);

  const showFlash = useCallback((text: string) => {
    setFlash(text);
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = setTimeout(() => setFlash(null), 2600);
  }, []);

  // Carga inicial: archivo, posicion, ajustes y subrayados.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [base64, savedCfi, settings, bookHighlights] = await Promise.all([
          readBookBase64(book),
          loadPosition(bookId),
          loadReadingSettings(),
          highlightsForBook(bookId),
        ]);
        if (cancelled) return;
        if (!base64) {
          Alert.alert('Archivo no disponible', 'Ese libro ya no existe en almacenamiento local.');
          onExit();
          return;
        }
        setReadingSettings(settings);
        setHighlights(bookHighlights);
        setStartCfi(savedCfi);
        setBookBase64(base64);
        track('open_book', {
          highlights: bookHighlights.length,
          progress: Math.round((book.progress || 0) * 100),
        });
      } catch (error) {
        captureException(error, { where: 'reader_load' });
        Alert.alert(
          'Error',
          error instanceof Error ? error.message : 'No se pudo abrir el libro seleccionado',
        );
        onExit();
      }
    })();
    const openedAt = openedAtRef.current;
    return () => {
      cancelled = true;
      track('close_book', { seconds: Math.round((Date.now() - openedAt) / 1000) });
      [saveTimeoutRef, controlsTimeoutRef, flashTimeoutRef].forEach((ref) => {
        if (ref.current) clearTimeout(ref.current);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  useEffect(() => {
    if (!bookBase64 || !webReady) return;
    sendCommand({ type: 'setHighlights', payload: { items: highlights.map((item) => ({ cfi: item.cfi })) } });
    sendCommand({ type: 'loadBook', payload: { base64: bookBase64, startCfi } });
    // Solo al tener libro y WebView listos; los subrayados nuevos se envian uno a uno.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookBase64, startCfi, webReady, sendCommand]);

  // Si los subrayados cambian fuera del lector (pantalla de notas, respaldo), sincroniza las marcas.
  const highlightsRef = useRef<Highlight[]>([]);
  highlightsRef.current = highlights;
  useEffect(
    () =>
      onHighlightsChanged(() => {
        void highlightsForBook(bookId).then((fresh) => {
          const before = new Set(highlightsRef.current.map((item) => item.cfi));
          const after = new Set(fresh.map((item) => item.cfi));
          before.forEach((cfi) => {
            if (!after.has(cfi)) sendCommand({ type: 'removeHighlight', payload: { cfi } });
          });
          after.forEach((cfi) => {
            if (!before.has(cfi)) sendCommand({ type: 'addHighlight', payload: { cfi } });
          });
          setHighlights(fresh);
        });
      }) as () => void,
    [bookId, sendCommand],
  );

  useEffect(() => {
    if (!webReady) return;
    sendCommand({ type: 'setReadingSettings', payload: readingSettings });
  }, [readingSettings, sendCommand, webReady]);

  useEffect(() => {
    if (!bookReady || !showControls || activePanel || selection) return;
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 2500);
  }, [activePanel, bookReady, progress, showControls, selection]);

  const updateReadingSettings = useCallback((patch: Partial<ReadingSettings>) => {
    setShowControls(true);
    setReadingSettings((prev) => {
      const next = clampSettings({ ...prev, ...patch }, prev);
      saveReadingSettings(next).catch(() => undefined);
      return next;
    });
  }, []);

  const openPanel = useCallback((panel: Panel) => {
    setShowControls(true);
    setActivePanel((current) => (current === panel ? null : panel));
    if (panel === 'study') track('study_panel_opened');
  }, []);

  const goToTarget = useCallback(
    (target: string) => {
      sendCommand({ type: 'goTo', payload: { target } });
      setActivePanel(null);
      setShowControls(false);
    },
    [sendCommand],
  );

  const submitSearch = useCallback(() => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    track('search_in_book');
    sendCommand({ type: 'search', payload: { query } });
  }, [searchQuery, sendCommand]);

  const goToLibrary = onExit;

  // ---- Subrayados y notas ----
  const cancelSelection = useCallback(() => {
    setSelection(null);
    sendCommand({ type: 'clearSelection' });
  }, [sendCommand]);

  const createHighlight = useCallback(
    async (fromSelection: TextSelection, note?: string) => {
      try {
        const saved = await addHighlight({
          bookId,
          bookTitle: bookName,
          cfi: fromSelection.cfi,
          text: fromSelection.text,
          chapter: fromSelection.chapter,
          note: note?.trim() || undefined,
        });
        sendCommand({ type: 'addHighlight', payload: { cfi: saved.cfi } });
        setHighlights((prev) => (prev.some((item) => item.id === saved.id) ? prev : [...prev, saved]));
        setSelection(null);
        track('highlight_created', { has_note: Boolean(note?.trim()), total_in_book: highlights.length + 1 });
        if (note?.trim()) track('note_created');
        showFlash('Subrayado guardado · ya esta en tu repaso');
      } catch (error) {
        captureException(error, { where: 'createHighlight' });
        Alert.alert('Error', 'No se pudo guardar el subrayado.');
      }
    },
    [bookId, bookName, highlights.length, sendCommand, showFlash],
  );

  const saveNoteDraft = useCallback(async () => {
    if (!noteDraft) return;
    const text = noteDraft.text.trim();
    if (noteDraft.highlight) {
      await updateHighlight(noteDraft.highlight.id, { note: text || undefined });
      setHighlights((prev) =>
        prev.map((item) =>
          item.id === noteDraft.highlight?.id ? { ...item, note: text || undefined } : item,
        ),
      );
      if (text) track('note_created', { edited: true });
      showFlash('Nota guardada');
    } else if (noteDraft.selection) {
      await createHighlight(noteDraft.selection, text);
    }
    setNoteDraft(null);
  }, [createHighlight, noteDraft, showFlash]);

  const onHighlightTapped = useCallback(
    (cfi: string) => {
      const target = highlights.find((item) => item.cfi === cfi);
      if (!target) return;
      Alert.alert('Subrayado', target.note ? `Nota: ${target.note}` : target.text.slice(0, 160), [
        {
          text: target.note ? 'Editar nota' : 'Agregar nota',
          onPress: () => setNoteDraft({ highlight: target, text: target.note || '' }),
        },
        {
          text: 'Quitar subrayado',
          style: 'destructive',
          onPress: async () => {
            await removeHighlight(target.id);
            sendCommand({ type: 'removeHighlight', payload: { cfi } });
            setHighlights((prev) => prev.filter((item) => item.id !== target.id));
            track('highlight_removed');
          },
        },
        { text: 'Cerrar', style: 'cancel' },
      ]);
    },
    [highlights, sendCommand],
  );

  // ---- Resumen IA del capitulo ----
  const requestSummary = useCallback(async () => {
    setActivePanel(null);
    const requestId = newId();
    pendingSummaryRef.current = requestId;
    setSummaryState({ loading: true });
    sendCommand({ type: 'getChapterText', payload: { requestId } });
  }, [sendCommand]);

  const handleChapterText = useCallback(
    async (payload: {
      requestId?: string;
      href?: string;
      chapter?: string;
      text?: string;
      error?: string;
    }) => {
      if (!payload.requestId || payload.requestId !== pendingSummaryRef.current) return;
      pendingSummaryRef.current = null;
      if (payload.error || !payload.href) {
        setSummaryState({ loading: false, error: payload.error || 'No se pudo leer el capitulo.' });
        return;
      }
      const all = await loadSummaries();
      const cached = all[`${bookId}|${payload.href}`];
      if (cached) {
        setSummaryState({ loading: false, summary: cached });
        track('summary_cached_opened');
        return;
      }
      const usedInBook = Object.values(all).filter((item) => item.bookId === bookId).length;
      if (!isPro && usedInBook >= FREE_LIMITS.summariesPerBook) {
        setSummaryState(null);
        onOpenPaywall('summary_limit');
        return;
      }
      try {
        const summary = await summarizeChapter({
          bookId,
          bookTitle: bookName,
          href: payload.href,
          chapter: payload.chapter || 'Capitulo',
          text: payload.text || '',
        });
        setSummaryState({ loading: false, summary });
      } catch (error) {
        if (error instanceof SummaryQuotaError) {
          setSummaryState(null);
          onOpenPaywall('summary_quota');
          return;
        }
        setSummaryState({
          loading: false,
          error: error instanceof Error ? error.message : 'No se pudo resumir.',
        });
      }
    },
    [bookId, bookName, isPro, onOpenPaywall],
  );

  const onWebViewMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const raw = String(event.nativeEvent.data ?? '');
        if (!raw || raw[0] !== '{') return;
        const parsed = JSON.parse(raw) as ReaderEvent;

        switch (parsed.type) {
          case 'ready':
            setBookReady(true);
            setShowControls(true);
            setStatusText('Calculando paginas...');
            sendCommand({ type: 'setReadingSettings', payload: readingSettings });
            return;
          case 'metadata':
            if (parsed.payload?.title) setBookName(parsed.payload.title);
            onPatchBook(bookId, {
              ...(parsed.payload?.title ? { title: parsed.payload.title } : null),
              ...(parsed.payload?.coverDataUrl ? { coverUri: parsed.payload.coverDataUrl } : null),
            });
            return;
          case 'toc':
            setTocItems(parsed.payload?.items || []);
            return;
          case 'searchResults':
            setIsSearching(false);
            setSearchResults(parsed.payload?.results || []);
            return;
          case 'relocated': {
            const payload = parsed.payload;
            if (typeof payload?.percentage === 'number') setProgress(payload.percentage);
            if (payload?.chapter) setCurrentChapter(payload.chapter);
            if (typeof payload?.currentPage === 'number' && typeof payload?.totalPages === 'number') {
              setStatusText(`${payload.currentPage}/${payload.totalPages}`);
            } else if (typeof payload?.currentPage === 'number') {
              setStatusText(`${payload.currentPage}/...`);
            }
            if (payload?.cfi) {
              if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
              saveTimeoutRef.current = setTimeout(() => {
                savePosition(bookId, payload.cfi || '').catch(() => undefined);
                onPatchBook(bookId, {
                  progress: typeof payload.percentage === 'number' ? payload.percentage : progress,
                  lastOpenedAt: Date.now(),
                });
              }, 450);
            }
            return;
          }
          case 'selection':
            if (parsed.payload?.cfi && parsed.payload.text) {
              setSelection(parsed.payload);
              setActivePanel(null);
            }
            return;
          case 'highlightTapped':
            if (parsed.payload?.cfi) onHighlightTapped(parsed.payload.cfi);
            return;
          case 'chapterText':
            void handleChapterText(parsed.payload || {});
            return;
          case 'loading':
            if (parsed.payload?.message) setStatusText(parsed.payload.message);
            return;
          case 'error':
            setStatusText(parsed.payload?.message || 'Error desconocido');
            captureException(new Error(parsed.payload?.message || 'reader_error'), { where: 'webview' });
            Alert.alert('Error en lector', parsed.payload?.message || 'Error desconocido');
            return;
          default:
            return;
        }
      } catch (error) {
        captureException(error, { where: 'onWebViewMessage' });
      }
    },
    [bookId, handleChapterText, onHighlightTapped, onPatchBook, progress, readingSettings, sendCommand],
  );

  return (
    <>
      <View style={[styles.readerContainer, bookReady && styles.readerContainerFullscreen]}>
        <WebView
          ref={webViewRef}
          source={{ html: READER_HTML }}
          originWhitelist={['*']}
          onLoadEnd={() => setWebReady(true)}
          onMessage={onWebViewMessage}
          allowFileAccess
          allowUniversalAccessFromFileURLs
          javaScriptEnabled
          domStorageEnabled
          style={styles.webView}
        />
      </View>

      {bookReady && (
        <TouchableOpacity style={styles.controlsToggle} onPress={() => setShowControls((v) => !v)}>
          <Text style={styles.controlsToggleText}>{showControls ? 'Cerrar' : 'Menu'}</Text>
        </TouchableOpacity>
      )}

      {bookReady && (
        <View style={[styles.readerMenu, !showControls && styles.hiddenControls]}>
          <View style={styles.menuTabs}>
            <TouchableOpacity style={styles.tabButton} onPress={() => openPanel('settings')}>
              <Text style={styles.tabButtonText}>Ajustes</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.tabButton} onPress={() => openPanel('toc')}>
              <Text style={styles.tabButtonText}>Indice</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.tabButton} onPress={() => openPanel('search')}>
              <Text style={styles.tabButtonText}>Buscar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.tabButton} onPress={() => openPanel('study')}>
              <Text style={styles.tabButtonText}>Estudio</Text>
            </TouchableOpacity>
          </View>

          {activePanel === 'settings' && (
            <View style={styles.panel}>
              <View style={styles.themeRow}>
                {(['light', 'sepia', 'dark'] as ReaderTheme[]).map((theme) => (
                  <TouchableOpacity
                    key={theme}
                    style={[styles.themeButton, readingSettings.theme === theme && styles.themeButtonActive]}
                    onPress={() => updateReadingSettings({ theme })}
                  >
                    <Text style={styles.themeButtonText}>
                      {theme === 'light' ? 'Claro' : theme === 'sepia' ? 'Sepia' : 'Oscuro'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>Fuente</Text>
                <TouchableOpacity
                  style={styles.smallButton}
                  onPress={() => updateReadingSettings({ fontScale: readingSettings.fontScale - 0.1 })}
                >
                  <Text style={styles.smallButtonText}>A-</Text>
                </TouchableOpacity>
                <Text style={styles.fontLabel}>{Math.round(readingSettings.fontScale * 100)}%</Text>
                <TouchableOpacity
                  style={styles.smallButton}
                  onPress={() => updateReadingSettings({ fontScale: readingSettings.fontScale + 0.1 })}
                >
                  <Text style={styles.smallButtonText}>A+</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>Interlineado</Text>
                <TouchableOpacity
                  style={styles.smallButton}
                  onPress={() => updateReadingSettings({ lineHeight: readingSettings.lineHeight - 0.1 })}
                >
                  <Text style={styles.smallButtonText}>-</Text>
                </TouchableOpacity>
                <Text style={styles.fontLabel}>{readingSettings.lineHeight.toFixed(1)}</Text>
                <TouchableOpacity
                  style={styles.smallButton}
                  onPress={() => updateReadingSettings({ lineHeight: readingSettings.lineHeight + 0.1 })}
                >
                  <Text style={styles.smallButtonText}>+</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>Margen</Text>
                <TouchableOpacity
                  style={styles.smallButton}
                  onPress={() => updateReadingSettings({ margin: readingSettings.margin - 4 })}
                >
                  <Text style={styles.smallButtonText}>-</Text>
                </TouchableOpacity>
                <Text style={styles.fontLabel}>{readingSettings.margin}px</Text>
                <TouchableOpacity
                  style={styles.smallButton}
                  onPress={() => updateReadingSettings({ margin: readingSettings.margin + 4 })}
                >
                  <Text style={styles.smallButtonText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {activePanel === 'toc' && (
            <ScrollView style={styles.panelList} nestedScrollEnabled>
              {tocItems.length === 0 ? (
                <Text style={styles.emptyPanelText}>Este EPUB no expone tabla de contenidos.</Text>
              ) : (
                tocItems.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.listButton, { paddingLeft: 12 + item.level * 12 }]}
                    onPress={() => goToTarget(item.href)}
                  >
                    <Text style={styles.listButtonText} numberOfLines={2}>
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          )}

          {activePanel === 'search' && (
            <View style={styles.panel}>
              <View style={styles.searchRow}>
                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  onSubmitEditing={submitSearch}
                  placeholder="Buscar en el libro"
                  placeholderTextColor="#818b9c"
                  returnKeyType="search"
                  style={styles.searchInput}
                />
                <TouchableOpacity style={styles.searchButton} onPress={submitSearch}>
                  <Text style={styles.searchButtonText}>{isSearching ? '...' : 'Ir'}</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.searchResults} nestedScrollEnabled>
                {searchResults.length === 0 ? (
                  <Text style={styles.emptyPanelText}>
                    {isSearching ? 'Buscando...' : 'Escribe al menos 2 caracteres.'}
                  </Text>
                ) : (
                  searchResults.map((result) => (
                    <TouchableOpacity
                      key={result.id}
                      style={styles.searchResult}
                      onPress={() => goToTarget(result.cfi)}
                    >
                      <Text style={styles.searchResultLabel} numberOfLines={1}>
                        {result.label}
                      </Text>
                      <Text style={styles.searchResultText} numberOfLines={3}>
                        {result.excerpt}
                      </Text>
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>
            </View>
          )}

          {activePanel === 'study' && (
            <View style={styles.panel}>
              <Text style={local.studyText}>
                {highlights.length} {highlights.length === 1 ? 'subrayado' : 'subrayados'} en este libro
                {currentChapter ? ` · ${currentChapter}` : ''}
              </Text>
              <Text style={local.studyHint}>
                Manten presionado el texto para subrayar o anotar. Toca un subrayado para editarlo.
              </Text>
              <TouchableOpacity style={local.studyButton} onPress={() => void requestSummary()}>
                <Text style={local.studyButtonText}>
                  Resumir este capitulo con IA{isPro ? '' : ' · 1 gratis por libro'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={local.studyButtonSecondary}
                onPress={() => onOpenNotes(bookId, bookName)}
              >
                <Text style={local.studyButtonSecondaryText}>Notas, resumenes y exportar</Text>
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity style={styles.exitButton} onPress={goToLibrary}>
            <Text style={styles.exitButtonText}>Salir del libro</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={[styles.statusBar, bookReady && styles.statusBarFloating]}>
        <Text numberOfLines={1} style={styles.statusText}>
          {flash || statusText}
        </Text>
      </View>

      {selection && (
        <View style={local.selectionBar}>
          <Text numberOfLines={2} style={local.selectionText}>
            “{selection.text}”
          </Text>
          <View style={local.selectionActions}>
            <TouchableOpacity style={local.selectionPrimary} onPress={() => void createHighlight(selection)}>
              <Text style={local.selectionPrimaryText}>Subrayar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={local.selectionSecondary}
              onPress={() => setNoteDraft({ selection, text: '' })}
            >
              <Text style={local.selectionSecondaryText}>Nota</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={local.selectionSecondary}
              onPress={cancelSelection}
              accessibilityLabel="Cancelar"
            >
              <Text style={local.selectionSecondaryText}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Modal
        visible={Boolean(noteDraft)}
        transparent
        animationType="fade"
        onRequestClose={() => setNoteDraft(null)}
      >
        <View style={local.modalBackdrop}>
          <View style={local.modalCard}>
            <Text style={local.modalTitle}>{noteDraft?.highlight?.note ? 'Editar nota' : 'Nueva nota'}</Text>
            <Text numberOfLines={3} style={local.modalQuote}>
              {noteDraft?.selection?.text || noteDraft?.highlight?.text}
            </Text>
            <TextInput
              value={noteDraft?.text ?? ''}
              onChangeText={(text) => setNoteDraft((prev) => (prev ? { ...prev, text } : prev))}
              placeholder="¿Que idea quieres recordar?"
              placeholderTextColor="#8b8172"
              multiline
              autoFocus
              style={local.noteInput}
            />
            <View style={local.modalActions}>
              <TouchableOpacity style={local.modalSecondary} onPress={() => setNoteDraft(null)}>
                <Text style={local.selectionSecondaryText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={local.selectionPrimary} onPress={() => void saveNoteDraft()}>
                <Text style={local.selectionPrimaryText}>Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(summaryState)}
        transparent
        animationType="slide"
        onRequestClose={() => setSummaryState(null)}
      >
        <View style={local.modalBackdrop}>
          <View style={[local.modalCard, local.summaryCard]}>
            <Text style={local.modalTitle}>
              {summaryState?.summary?.chapter || currentChapter || 'Resumen del capitulo'}
            </Text>
            {summaryState?.loading ? (
              <View style={local.summaryLoading}>
                <ActivityIndicator color="#352c21" />
                <Text style={local.modalQuote}>Leyendo el capitulo y preparando el resumen…</Text>
              </View>
            ) : summaryState?.error ? (
              <Text style={local.errorText}>{summaryState.error}</Text>
            ) : (
              <ScrollView style={local.summaryScroll}>
                <Text style={local.summaryText}>{summaryState?.summary?.summary}</Text>
              </ScrollView>
            )}
            <View style={local.modalActions}>
              <TouchableOpacity
                style={local.modalSecondary}
                onPress={() => {
                  setSummaryState(null);
                  onOpenNotes(bookId, bookName);
                }}
              >
                <Text style={local.selectionSecondaryText}>Ver todas las notas</Text>
              </TouchableOpacity>
              <TouchableOpacity style={local.selectionPrimary} onPress={() => setSummaryState(null)}>
                <Text style={local.selectionPrimaryText}>Cerrar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const local = StyleSheet.create({
  studyText: { color: '#2a3240', fontSize: 14, fontWeight: '700' },
  studyHint: { color: '#5b6474', fontSize: 12 },
  studyButton: { borderRadius: 14, backgroundColor: '#111827', paddingVertical: 12, alignItems: 'center' },
  studyButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  studyButtonSecondary: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(116, 126, 146, 0.28)',
    backgroundColor: '#ffffff',
    paddingVertical: 12,
    alignItems: 'center',
  },
  studyButtonSecondaryText: { color: '#2a3240', fontSize: 14, fontWeight: '700' },
  selectionBar: {
    position: 'absolute',
    left: 14,
    right: 14,
    top: 14,
    zIndex: 40,
    borderRadius: 18,
    backgroundColor: 'rgba(17, 24, 39, 0.94)',
    padding: 12,
    gap: 10,
  },
  selectionText: { color: '#f7e5cc', fontSize: 13, fontStyle: 'italic' },
  selectionActions: { flexDirection: 'row', gap: 8 },
  selectionPrimary: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#f2c94c',
    paddingVertical: 10,
    alignItems: 'center',
  },
  selectionPrimaryText: { color: '#1d1b18', fontSize: 14, fontWeight: '800' },
  selectionSecondary: {
    borderRadius: 12,
    backgroundColor: '#ffffff',
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  selectionSecondaryText: { color: '#1d1b18', fontSize: 14, fontWeight: '700' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 18 },
  modalCard: { borderRadius: 18, backgroundColor: '#fffdf8', padding: 16, gap: 12 },
  modalTitle: { color: '#352c21', fontSize: 17, fontWeight: '700' },
  modalQuote: { color: '#6b5f4f', fontSize: 13, fontStyle: 'italic' },
  noteInput: {
    minHeight: 110,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dfd4c0',
    backgroundColor: '#ffffff',
    padding: 12,
    fontSize: 15,
    color: '#352c21',
    textAlignVertical: 'top',
  },
  modalActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  modalSecondary: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dfd4c0',
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  summaryCard: { maxHeight: '85%' },
  summaryLoading: { alignItems: 'center', gap: 10, paddingVertical: 24 },
  summaryScroll: { maxHeight: 420 },
  summaryText: { color: '#352c21', fontSize: 15, lineHeight: 23 },
  errorText: { color: '#8a2f2f', fontSize: 14 },
});
