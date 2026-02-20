import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

type WebCommand =
  | { type: 'loadBook'; payload: { base64: string; startCfi?: string | null } }
  | { type: 'nextPage' }
  | { type: 'prevPage' }
  | { type: 'setFontScale'; payload: { scale: number } }
  | { type: 'goToPercentage'; payload: { percentage: number } };

type ReaderEvent =
  | { type: 'ready' }
  | { type: 'metadata'; payload?: { title?: string } }
  | { type: 'relocated'; payload?: { percentage?: number; cfi?: string } }
  | { type: 'loading'; payload?: { message?: string } }
  | { type: 'error'; payload?: { message?: string } };

type LibraryBook = {
  id: string;
  name: string;
  title: string;
  uri: string;
  progress: number;
  lastOpenedAt: number;
};

const LIBRARY_STORAGE_KEY = 'epub:library:v1';
const BOOKS_DIR_NAME = 'books';

const bookIdFromFile = (name: string, size?: number) =>
  `${name || 'book'}|${size || 0}`.replace(/[^a-zA-Z0-9|._-]/g, '_');

const fileNameFromBookId = (bookId: string) => `${encodeURIComponent(bookId)}.epub`;

const READER_HTML = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/epubjs/dist/epub.min.js"></script>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #f6f1e8;
      }
      #viewer {
        width: 100%;
        height: 100%;
      }
      #loader {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #302d26;
        font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;
        font-size: 15px;
        background: #f6f1e8;
      }
    </style>
  </head>
  <body>
    <div id="loader">Cargando lector…</div>
    <div id="viewer"></div>
    <script>
      const postToApp = (type, payload) => {
        window.ReactNativeWebView?.postMessage(JSON.stringify({ type, payload }));
      };

      const fromBase64ToArrayBuffer = (base64) => {
        const raw = atob(base64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
        return bytes.buffer;
      };

      let book = null;
      let rendition = null;

      const hideLoader = () => {
        const loader = document.getElementById('loader');
        if (loader) loader.style.display = 'none';
      };
      const showLoader = (text) => {
        const loader = document.getElementById('loader');
        if (!loader) return;
        loader.textContent = text || 'Cargando lector…';
        loader.style.display = 'flex';
      };
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const hasVisibleContent = () => {
        if (!rendition) return false;
        const contents = rendition.getContents?.() || [];
        if (!contents.length) return false;

        return contents.some((content) => {
          const doc = content?.document;
          if (!doc?.body) return false;
          const text = (doc.body.innerText || '').replace(/\\s+/g, ' ').trim();
          const hasMedia = Boolean(doc.body.querySelector('img, svg, video, canvas, table, pre'));
          return text.length > 20 || hasMedia;
        });
      };
      const skipBlankPagesIfNeeded = async () => {
        if (!rendition) return;
        for (let i = 0; i < 8; i += 1) {
          await wait(40);
          if (hasVisibleContent()) return;
          await rendition.next();
        }
      };

      const loadBook = async (base64, startCfi) => {
        try {
          if (!window.JSZip) {
            throw new Error('JSZip no se cargo en el WebView');
          }
          showLoader('Preparando libro...');
          postToApp('loading', { message: 'Preparando libro...' });

          if (rendition) {
            try {
              rendition.destroy();
            } catch {}
          }
          if (book && typeof book.destroy === 'function') {
            try {
              book.destroy();
            } catch {}
          }

          const viewer = document.getElementById('viewer');
          if (viewer) {
            viewer.innerHTML = '';
          }

          const buffer = fromBase64ToArrayBuffer(base64);
          book = ePub(buffer);
          rendition = book.renderTo('viewer', {
            width: '100%',
            height: '100%',
            spread: 'none',
            flow: 'scrolled-doc',
            manager: 'continuous',
          });

          rendition.themes.default({
            body: {
              'font-family': "Georgia, 'Times New Roman', serif",
              'line-height': '1.6',
              color: '#1d1b18',
              background: '#f6f1e8'
            }
          });
          rendition.themes.override('color', '#1d1b18', true);
          rendition.themes.override('background', '#f6f1e8', true);

          rendition.on('relocated', (location) => {
            if (!location?.start?.cfi) return;
            const cfi = location.start.cfi;
            const percentageFromLocation = Number(location?.start?.percentage);
            const percentage = Number.isFinite(percentageFromLocation)
              ? percentageFromLocation
              : undefined;
            postToApp('relocated', { percentage, cfi });
          });

          const displayTargets = [];
          if (startCfi) displayTargets.push(startCfi);
          displayTargets.push(undefined);

          const firstSection = book.spine?.first?.();
          if (firstSection?.href) {
            displayTargets.push(firstSection.href);
          }

          let rendered = false;
          for (const target of displayTargets) {
            try {
              if (typeof target === 'string') {
                await rendition.display(target);
              } else {
                await rendition.display();
              }

              const currentLocation = rendition.currentLocation?.();
              if (currentLocation?.start?.cfi) {
                rendered = true;
                break;
              }
            } catch {}
          }

          if (!rendered) {
            throw new Error('No se pudo renderizar el contenido del EPUB');
          }

          await skipBlankPagesIfNeeded();

          hideLoader();
          postToApp('ready');

          postToApp('loading', { message: 'Cargando metadatos...' });
          await book.ready;

          const metadata = await book.loaded.metadata;
          postToApp('metadata', { title: metadata?.title || '' });
          postToApp('loading', { message: 'Libro listo' });
        } catch (error) {
          hideLoader();
          postToApp('error', {
            message: error instanceof Error ? error.message : 'No se pudo abrir el EPUB',
          });
        }
      };

      const onMessage = async (event) => {
        const raw = String(event?.data ?? '');
        if (!raw || raw[0] !== '{') return;

        let message = null;
        try {
          message = JSON.parse(raw);
        } catch {
          return;
        }

        try {
          switch (message.type) {
            case 'loadBook':
              await loadBook(message.payload.base64, message.payload.startCfi);
              break;
            case 'nextPage':
              await rendition?.next();
              break;
            case 'prevPage':
              await rendition?.prev();
              break;
            case 'goToPercentage':
              if (book && book.locations?.length()) {
                const clamped = Math.min(1, Math.max(0, Number(message.payload?.percentage || 0)));
                const cfi = book.locations.cfiFromPercentage(clamped);
                if (cfi) await rendition?.display(cfi);
              }
              break;
            case 'setFontScale':
              if (rendition) {
                const scale = Math.min(1.8, Math.max(0.8, Number(message.payload?.scale || 1)));
                rendition.themes.fontSize(Math.round(scale * 100) + '%');
              }
              break;
            default:
              break;
          }
        } catch (error) {
          postToApp('error', {
            message: error instanceof Error ? error.message : 'Mensaje no valido en lector',
          });
        }
      };

      window.addEventListener('message', onMessage);
      document.addEventListener('message', onMessage);
    </script>
  </body>
</html>`;

export default function App() {
  const webViewRef = useRef<WebView>(null);

  const [bookBase64, setBookBase64] = useState<string | null>(null);
  const [bookName, setBookName] = useState('Sin libro');
  const [bookId, setBookId] = useState<string | null>(null);
  const [startCfi, setStartCfi] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibraryBook[]>([]);
  const [webReady, setWebReady] = useState(false);
  const [bookReady, setBookReady] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [fontScale, setFontScale] = useState(1);
  const [progress, setProgress] = useState(0);
  const [isPickingFile, setIsPickingFile] = useState(false);
  const [statusText, setStatusText] = useState('Selecciona un EPUB para comenzar');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendCommand = useCallback((command: WebCommand) => {
    webViewRef.current?.postMessage(JSON.stringify(command));
  }, []);

  const persistLibrary = useCallback(async (nextLibrary: LibraryBook[]) => {
    setLibrary(nextLibrary);
    await AsyncStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(nextLibrary));
  }, []);

  const upsertLibraryBook = useCallback(
    async (book: LibraryBook) => {
      const next = [book, ...library.filter((entry) => entry.id !== book.id)].slice(0, 30);
      await persistLibrary(next);
    },
    [library, persistLibrary],
  );

  const openLibraryBook = useCallback(async (entry: LibraryBook) => {
    try {
      const info = await FileSystem.getInfoAsync(entry.uri);
      if (!info.exists) {
        const next = library.filter((book) => book.id !== entry.id);
        await persistLibrary(next);
        Alert.alert('Archivo no disponible', 'Ese libro ya no existe en almacenamiento local.');
        return;
      }

      const base64 = await FileSystem.readAsStringAsync(entry.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const savedCfi = await AsyncStorage.getItem(`epub:position:${entry.id}`);

      setBookId(entry.id);
      setBookName(entry.title || entry.name);
      setWebReady(false);
      setBookBase64(base64);
      setStartCfi(savedCfi);
      setBookReady(false);
      setShowControls(true);
      setProgress(entry.progress || 0);
      setStatusText('Cargando EPUB...');

      await upsertLibraryBook({
        ...entry,
        lastOpenedAt: Date.now(),
      });
    } catch (error) {
      Alert.alert(
        'Error',
        error instanceof Error ? error.message : 'No se pudo abrir el libro seleccionado',
      );
    }
  }, [library, persistLibrary, upsertLibraryBook]);

  const pickEpubFile = useCallback(async () => {
    try {
      setIsPickingFile(true);
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/epub+zip',
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const file = result.assets[0];
      const resolvedBookId = bookIdFromFile(file.name || 'book', file.size);
      if (!FileSystem.documentDirectory) {
        throw new Error('No hay directorio local disponible para guardar libros');
      }
      const directory = `${FileSystem.documentDirectory}${BOOKS_DIR_NAME}/`;
      const persistedUri = `${directory}${fileNameFromBookId(resolvedBookId)}`;

      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      const existing = await FileSystem.getInfoAsync(persistedUri);
      if (existing.exists) {
        await FileSystem.deleteAsync(persistedUri, { idempotent: true });
      }
      await FileSystem.copyAsync({ from: file.uri, to: persistedUri });

      const newEntry: LibraryBook = {
        id: resolvedBookId,
        name: file.name || 'Libro sin titulo',
        title: file.name || 'Libro sin titulo',
        uri: persistedUri,
        progress: 0,
        lastOpenedAt: Date.now(),
      };
      await upsertLibraryBook(newEntry);
      await openLibraryBook(newEntry);
    } catch (error) {
      Alert.alert(
        'Error',
        error instanceof Error ? error.message : 'No se pudo seleccionar el archivo',
      );
    } finally {
      setIsPickingFile(false);
    }
  }, [openLibraryBook, upsertLibraryBook]);

  const patchLibraryBook = useCallback((id: string, patch: Partial<LibraryBook>) => {
    setLibrary((prev) => {
      const next = prev.map((book) => (book.id === id ? { ...book, ...patch } : book));
      AsyncStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!bookBase64 || !webReady) {
      return;
    }
    sendCommand({ type: 'loadBook', payload: { base64: bookBase64, startCfi } });
  }, [bookBase64, startCfi, webReady, sendCommand]);

  useEffect(() => {
    if (!webReady) return;
    sendCommand({ type: 'setFontScale', payload: { scale: fontScale } });
  }, [fontScale, sendCommand, webReady]);

  useEffect(() => {
    AsyncStorage.getItem('epub:fontScale')
      .then((saved) => {
        if (!saved) return;
        const parsed = Number(saved);
        if (Number.isFinite(parsed)) {
          setFontScale(Math.min(1.8, Math.max(0.8, parsed)));
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(LIBRARY_STORAGE_KEY)
      .then((saved) => {
        if (!saved) return;
        const parsed = JSON.parse(saved) as LibraryBook[];
        if (Array.isArray(parsed)) {
          setLibrary(parsed);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!bookReady || !showControls) return;
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 2500);
  }, [bookReady, progress, showControls]);

  const changeFontScale = useCallback((delta: number) => {
    setShowControls(true);
    setFontScale((prev) => {
      const next = Math.min(1.8, Math.max(0.8, Number((prev + delta).toFixed(2))));
      AsyncStorage.setItem('epub:fontScale', String(next)).catch(() => undefined);
      return next;
    });
  }, []);

  const goToLibrary = useCallback(() => {
    setBookBase64(null);
    setBookReady(false);
    setWebReady(false);
    setShowControls(true);
    setStatusText('Selecciona un EPUB para comenzar');
  }, []);

  const onWebViewMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const raw = String(event.nativeEvent.data ?? '');
      if (!raw || raw[0] !== '{') {
        return;
      }
      const parsed = JSON.parse(raw) as ReaderEvent;
      if (parsed.type === 'ready') {
        setBookReady(true);
        setShowControls(true);
        setStatusText('Libro listo');
        sendCommand({ type: 'setFontScale', payload: { scale: fontScale } });
        return;
      }

      if (parsed.type === 'metadata') {
        if (parsed.payload?.title) {
          setBookName(parsed.payload.title);
          if (bookId) {
            patchLibraryBook(bookId, { title: parsed.payload.title });
          }
        }
        return;
      }

      if (parsed.type === 'relocated') {
        if (typeof parsed.payload?.percentage === 'number') {
          setProgress(parsed.payload.percentage);
        }
        if (bookId && parsed.payload?.cfi) {
          if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
          }
          saveTimeoutRef.current = setTimeout(() => {
            AsyncStorage.setItem(`epub:position:${bookId}`, parsed.payload?.cfi || '').catch(
              () => undefined,
            );
            patchLibraryBook(bookId, {
              progress:
                typeof parsed.payload?.percentage === 'number'
                  ? parsed.payload.percentage
                  : progress,
              lastOpenedAt: Date.now(),
            });
          }, 450);
        }
        return;
      }

      if (parsed.type === 'loading') {
        if (parsed.payload?.message) {
          setStatusText(parsed.payload.message);
        }
        return;
      }

      if (parsed.type === 'error') {
        setStatusText(parsed.payload?.message || 'Error desconocido');
        Alert.alert('Error en lector', parsed.payload?.message || 'Error desconocido');
      }
    } catch {
      Alert.alert('Error', 'No se pudo procesar el mensaje del lector');
    }
  }, [bookId, fontScale, patchLibraryBook, progress, sendCommand]);

  const shelfBooks = useMemo(() => {
    return library
      .slice()
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
      .slice(0, 7)
      .map((book) => book.title || book.name);
  }, [library]);

  const quickAccessBooks = useMemo(
    () => library.slice().sort((a, b) => b.lastOpenedAt - a.lastOpenedAt),
    [library],
  );

  const spineColors = ['#5b3a2b', '#6f5039', '#7d2f2f', '#3f5d57', '#49406a', '#7a5b2f', '#3f4a54'];

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />

      {!bookBase64 ? (
        <ScrollView contentContainerStyle={styles.homeContent} style={styles.homeScroll}>
          <View style={styles.header}>
            <View style={styles.toolbar}>
              <TouchableOpacity style={styles.button} onPress={pickEpubFile} disabled={isPickingFile}>
                <Text style={styles.buttonText}>
                  {isPickingFile ? 'Abriendo…' : 'Agregar EPUB'}
                </Text>
              </TouchableOpacity>
              <Text style={styles.progress}>{quickAccessBooks.length} libros</Text>
            </View>

            <View style={styles.shelfBackPanel}>
              <View style={styles.spineRow}>
                {(shelfBooks.length ? shelfBooks : ['Biblioteca', 'Sin', 'Libros', 'Aun']).map(
                  (title, index) => (
                    <View
                      key={`${title}-${index}`}
                      style={[
                        styles.spine,
                        {
                          backgroundColor: spineColors[index % spineColors.length],
                          height: 84 + (index % 4) * 14,
                        },
                      ]}
                    >
                      <View style={styles.spineStripe} />
                      <Text style={styles.spineText} numberOfLines={1}>
                        {title}
                      </Text>
                    </View>
                  ),
                )}
              </View>
              <View style={styles.shelfWood} />
            </View>

            <Text style={styles.bookTitle} numberOfLines={1}>
              Accesos directos
            </Text>
          </View>

          {quickAccessBooks.length === 0 ? (
            <View style={styles.emptyLibrary}>
              <Text style={styles.emptyLibraryTitle}>Tu librero esta vacio</Text>
              <Text style={styles.emptyLibraryText}>
                Agrega un EPUB y aparecera aqui para abrirlo con un toque.
              </Text>
            </View>
          ) : (
            <View style={styles.grid}>
              {quickAccessBooks.map((book, index) => (
                <TouchableOpacity
                  key={book.id}
                  style={styles.card}
                  onPress={() => openLibraryBook(book)}
                  activeOpacity={0.85}
                >
                  <View
                    style={[
                      styles.cover,
                      { backgroundColor: spineColors[index % spineColors.length] },
                    ]}
                  >
                    <Text style={styles.coverTitle} numberOfLines={3}>
                      {book.title || book.name}
                    </Text>
                  </View>
                  <Text numberOfLines={2} style={styles.cardTitle}>
                    {book.title || book.name}
                  </Text>
                  <Text style={styles.cardMeta}>Progreso: {Math.round((book.progress || 0) * 100)}%</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      ) : (
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
              <Text style={styles.controlsToggleText}>{showControls ? 'Ocultar' : 'Menu'}</Text>
            </TouchableOpacity>
          )}

          <View
            style={[
              styles.footer,
              bookReady && styles.footerFloating,
              bookReady && !showControls && styles.hiddenControls,
            ]}
          >
            <TouchableOpacity
              style={[styles.button, styles.navButton]}
              onPress={() => {
                setShowControls(true);
                sendCommand({ type: 'prevPage' });
              }}
              disabled={!bookReady}
            >
              <Text style={styles.buttonText}>Anterior</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.navButton]}
              onPress={() => {
                setShowControls(true);
                sendCommand({ type: 'nextPage' });
              }}
              disabled={!bookReady}
            >
              <Text style={styles.buttonText}>Siguiente</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.button, styles.changeBookButton]} onPress={goToLibrary}>
              <Text style={styles.buttonText}>Librero</Text>
            </TouchableOpacity>
          </View>

          {bookReady && (
            <View style={[styles.fontBar, !showControls && styles.hiddenControls]}>
              <TouchableOpacity style={styles.smallButton} onPress={() => changeFontScale(-0.1)}>
                <Text style={styles.smallButtonText}>A-</Text>
              </TouchableOpacity>
              <Text style={styles.fontLabel}>{Math.round(fontScale * 100)}%</Text>
              <TouchableOpacity style={styles.smallButton} onPress={() => changeFontScale(0.1)}>
                <Text style={styles.smallButtonText}>A+</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={[styles.statusBar, bookReady && styles.statusBarFloating]}>
            <Text numberOfLines={1} style={styles.statusText}>
              {statusText}
            </Text>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#261910',
  },
  homeScroll: {
    flex: 1,
  },
  homeContent: {
    paddingBottom: 24,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: '#4a2f1f',
    gap: 10,
    backgroundColor: '#3a2417',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  shelfBackPanel: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#4a3022',
    backgroundColor: '#29180f',
    paddingTop: 10,
    paddingHorizontal: 8,
    paddingBottom: 0,
  },
  spineRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    minHeight: 130,
    gap: 6,
    paddingHorizontal: 4,
  },
  spine: {
    flex: 1,
    minWidth: 30,
    maxWidth: 42,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  spineStripe: {
    width: '80%',
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(245, 215, 166, 0.85)',
  },
  spineText: {
    color: '#f0e2cf',
    fontSize: 10,
    fontWeight: '700',
    width: 88,
    textAlign: 'center',
    transform: [{ rotate: '-90deg' }],
  },
  shelfWood: {
    marginTop: 8,
    height: 16,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#7a512e',
    backgroundColor: '#8b5e36',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  card: {
    width: '30%',
    minWidth: 100,
    maxWidth: 140,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#6f4b35',
    backgroundColor: '#2b1b12',
    padding: 8,
  },
  cover: {
    aspectRatio: 0.68,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 10,
    justifyContent: 'flex-end',
  },
  coverTitle: {
    color: '#f7e7d1',
    fontSize: 12,
    fontWeight: '700',
  },
  cardTitle: {
    color: '#efd8b8',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
  },
  cardMeta: {
    color: '#be9f79',
    fontSize: 11,
    marginTop: 4,
  },
  emptyLibrary: {
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#6f4b35',
    backgroundColor: '#2b1b12',
    padding: 14,
    gap: 6,
  },
  emptyLibraryTitle: {
    color: '#efd8b8',
    fontWeight: '700',
    fontSize: 15,
  },
  emptyLibraryText: {
    color: '#be9f79',
    fontSize: 13,
  },
  readerContainer: {
    flex: 1,
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 10,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#4b3224',
    backgroundColor: '#f6f1e8',
  },
  readerContainerFullscreen: {
    marginHorizontal: 0,
    marginTop: 0,
    marginBottom: 0,
    borderRadius: 0,
    borderWidth: 0,
  },
  webView: {
    flex: 1,
    backgroundColor: '#f6f1e8',
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: '#3a2417',
  },
  footerFloating: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 58,
    backgroundColor: 'transparent',
  },
  hiddenControls: {
    opacity: 0,
  },
  controlsToggle: {
    position: 'absolute',
    right: 12,
    bottom: 20,
    zIndex: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#836044',
    backgroundColor: 'rgba(33, 21, 13, 0.86)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  controlsToggleText: {
    color: '#f2dec3',
    fontSize: 12,
    fontWeight: '700',
  },
  fontBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    zIndex: 25,
  },
  smallButton: {
    minWidth: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#8f5c3d',
    backgroundColor: '#6b3b2a',
    paddingVertical: 8,
    alignItems: 'center',
  },
  smallButtonText: {
    color: '#f7e5cc',
    fontWeight: '700',
  },
  fontLabel: {
    color: '#f2dec3',
    fontSize: 13,
    fontWeight: '700',
    minWidth: 54,
    textAlign: 'center',
  },
  statusBar: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: '#3a2417',
  },
  statusBarFloating: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(33, 22, 14, 0.8)',
  },
  statusText: {
    color: '#d1b088',
    fontSize: 12,
  },
  changeBookButton: {
    flex: 1,
    backgroundColor: '#4f5d31',
    borderColor: '#697a3f',
  },
  button: {
    backgroundColor: '#6b3b2a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#8f5c3d',
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navButton: {
    flex: 1,
  },
  buttonText: {
    color: '#f7e5cc',
    fontWeight: '600',
  },
  bookTitle: {
    color: '#f2dec3',
    fontSize: 16,
    fontWeight: '700',
  },
  progress: {
    color: '#d7ba93',
    fontSize: 14,
    fontWeight: '700',
  },
});
