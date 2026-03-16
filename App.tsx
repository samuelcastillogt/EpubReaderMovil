import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
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
  | { type: 'setFontScale'; payload: { scale: number } };

type ReaderEvent =
  | { type: 'ready' }
  | { type: 'metadata'; payload?: { title?: string; coverDataUrl?: string } }
  | {
      type: 'relocated';
      payload?: {
        percentage?: number;
        cfi?: string;
        currentPage?: number;
        totalPages?: number;
      };
    }
  | { type: 'loading'; payload?: { message?: string } }
  | { type: 'error'; payload?: { message?: string } };

type LibraryBook = {
  id: string;
  name: string;
  title: string;
  uri: string;
  coverUri?: string | null;
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
        position: relative;
        z-index: 1;
        width: 100%;
        height: 100%;
        transition: transform 170ms ease-out;
        will-change: transform;
        touch-action: none;
      }
      #pageShadow {
        position: absolute;
        inset: 0;
        z-index: 3;
        pointer-events: none;
        opacity: 0;
        transition: opacity 130ms ease-out;
      }
      #pageCurl {
        position: absolute;
        top: 0;
        bottom: 0;
        z-index: 4;
        width: 0;
        opacity: 0;
        pointer-events: none;
        transform-origin: right center;
        transition: opacity 110ms ease-out, width 110ms ease-out;
      }
      #loader {
        position: absolute;
        inset: 0;
        z-index: 6;
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
    <div id="pageShadow"></div>
    <div id="pageCurl"></div>
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
      const blobToDataUrl = (blob) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result || null);
          reader.onerror = () => reject(new Error('No se pudo leer la portada'));
          reader.readAsDataURL(blob);
        });

      let book = null;
      let rendition = null;
      let isAnimatingTurn = false;
      let isGestureActive = false;
      let isSwipeIntent = false;
      let gestureStartX = 0;
      let gestureStartY = 0;
      let gestureDeltaX = 0;
      let gestureWidth = 0;
      let totalVirtualPages = 0;

      const SWIPE_MIN_PX = 56;
      const SWIPE_TRIGGER_RATIO = 0.18;
      const SWIPE_RESISTANCE = 0.48;
      const TURN_OFFSET_RATIO = 0.2;

      const getViewer = () => document.getElementById('viewer');
      const getShadow = () => document.getElementById('pageShadow');
      const getCurl = () => document.getElementById('pageCurl');

      const setCurl = (offset, animated) => {
        const curl = getCurl();
        if (!curl) return;

        const width = Math.max(window.innerWidth, 320);
        const intensity = Math.min(1, Math.abs(offset) / (width * 0.32));
        const curlWidth = Math.max(0, Math.min(width * 0.26, Math.abs(offset) * 0.82));

        curl.style.transition = animated
          ? 'opacity 140ms ease-out, width 140ms ease-out, transform 140ms ease-out'
          : 'none';
        curl.style.opacity = intensity > 0.03 ? String(intensity * 0.95) : '0';
        curl.style.width = curlWidth + 'px';

        if (offset < 0) {
          curl.style.left = '';
          curl.style.right = '0';
          curl.style.transformOrigin = 'right center';
          curl.style.transform = 'perspective(900px) rotateY(' + (-intensity * 22) + 'deg)';
          curl.style.background =
            'linear-gradient(90deg, rgba(245,238,226,0.96) 0%, rgba(226,214,193,0.76) 38%, rgba(20,20,20,0.2) 100%)';
          return;
        }

        curl.style.right = '';
        curl.style.left = '0';
        curl.style.transformOrigin = 'left center';
        curl.style.transform = 'perspective(900px) rotateY(' + (intensity * 22) + 'deg)';
        curl.style.background =
          'linear-gradient(270deg, rgba(245,238,226,0.96) 0%, rgba(226,214,193,0.76) 38%, rgba(20,20,20,0.2) 100%)';
      };

      const setTurnOffset = (offset, animated) => {
        const viewer = getViewer();
        const shadow = getShadow();
        if (!viewer || !shadow) return;

        viewer.style.transition = animated ? 'transform 170ms ease-out' : 'none';
        viewer.style.transform = 'translate3d(' + offset + 'px, 0, 0)';

        const strength = Math.min(0.34, Math.abs(offset) / Math.max(1, window.innerWidth) * 0.42);
        shadow.style.opacity = String(strength);
        shadow.style.background = offset < 0
          ? 'linear-gradient(90deg, rgba(0,0,0,0.18), rgba(0,0,0,0) 44%)'
          : 'linear-gradient(270deg, rgba(0,0,0,0.18), rgba(0,0,0,0) 44%)';

        setCurl(offset, animated);
      };

      const resetTurnOffset = (animated) => {
        setTurnOffset(0, animated);
      };

      const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

      const pagePayloadFromLocation = (location) => {
        if (!location?.start?.cfi) return null;

        const cfi = location.start.cfi;
        const percentageFromLocation = Number(location?.start?.percentage);
        let percentage = Number.isFinite(percentageFromLocation) ? percentageFromLocation : null;

        if (!Number.isFinite(percentage) && book?.locations && typeof book.locations.percentageFromCfi === 'function') {
          const computed = Number(book.locations.percentageFromCfi(cfi));
          if (Number.isFinite(computed)) percentage = computed;
        }

        const normalized = Number.isFinite(percentage) ? clamp(Number(percentage), 0, 1) : null;
        const totalPages = Number(totalVirtualPages) || Number(book?.locations?.length?.() || 0);
        const currentPage =
          Number.isFinite(normalized) && totalPages > 0
            ? clamp(Math.floor(normalized * (totalPages - 1)) + 1, 1, totalPages)
            : undefined;

        return {
          cfi,
          percentage: Number.isFinite(normalized) ? normalized : undefined,
          currentPage,
          totalPages: totalPages > 0 ? totalPages : undefined,
        };
      };

      const emitRelocated = (location) => {
        const payload = pagePayloadFromLocation(location);
        if (!payload) return;
        postToApp('relocated', payload);
      };

      const animatePageTurn = async (direction) => {
        if (!rendition || isAnimatingTurn) return;
        isAnimatingTurn = true;
        const width = Math.max(window.innerWidth, 320);
        const offset = Math.round(width * TURN_OFFSET_RATIO);
        const leavingOffset = direction === 'next' ? -offset : offset;
        const enteringOffset = direction === 'next' ? offset : -offset;

        setTurnOffset(leavingOffset, true);
        await wait(120);

        try {
          if (direction === 'next') {
            await rendition.next();
          } else {
            await rendition.prev();
          }
        } catch {}

        setTurnOffset(enteringOffset, false);
        await wait(16);
        setTurnOffset(0, true);
        await wait(170);
        resetTurnOffset(false);
        isAnimatingTurn = false;
      };

      const onGestureStart = (x, y) => {
        if (!rendition || isAnimatingTurn) return;
        isGestureActive = true;
        isSwipeIntent = false;
        gestureStartX = x;
        gestureStartY = y;
        gestureDeltaX = 0;
        gestureWidth = Math.max(window.innerWidth, 320);
      };

      const onGestureMove = (x, y, preventDefaultFn) => {
        if (!isGestureActive || isAnimatingTurn) return;

        const dx = x - gestureStartX;
        const dy = y - gestureStartY;

        if (!isSwipeIntent) {
          const horizontalEnough = Math.abs(dx) > 10;
          const mostlyHorizontal = Math.abs(dx) > Math.abs(dy) * 1.25;
          if (!horizontalEnough || !mostlyHorizontal) return;
          isSwipeIntent = true;
        }

        if (preventDefaultFn) preventDefaultFn();
        gestureDeltaX = dx;
        setTurnOffset(dx * SWIPE_RESISTANCE, false);
      };

      const onGestureEnd = async () => {
        if (!isGestureActive) return;
        isGestureActive = false;

        if (!isSwipeIntent || isAnimatingTurn) {
          resetTurnOffset(true);
          return;
        }

        const threshold = Math.max(SWIPE_MIN_PX, gestureWidth * SWIPE_TRIGGER_RATIO);
        if (gestureDeltaX <= -threshold) {
          await animatePageTurn('next');
          return;
        }
        if (gestureDeltaX >= threshold) {
          await animatePageTurn('prev');
          return;
        }

        resetTurnOffset(true);
      };

      const attachSwipeHandlers = (doc) => {
        if (!doc || doc.__epubSwipeAttached) return;
        doc.__epubSwipeAttached = true;

        try {
          if (doc.documentElement) {
            doc.documentElement.style.touchAction = 'none';
            doc.documentElement.style.overscrollBehavior = 'none';
          }
          if (doc.body) {
            doc.body.style.touchAction = 'none';
            doc.body.style.overscrollBehavior = 'none';
          }
        } catch {}

        doc.addEventListener('pointerdown', (event) => {
          if (event.pointerType === 'mouse' && event.button !== 0) return;
          onGestureStart(event.clientX, event.clientY);
        });

        doc.addEventListener('pointermove', (event) => {
          onGestureMove(event.clientX, event.clientY, () => event.preventDefault());
        }, { passive: false });

        doc.addEventListener('pointerup', () => {
          onGestureEnd();
        });

        doc.addEventListener('pointercancel', () => {
          isGestureActive = false;
          isSwipeIntent = false;
          resetTurnOffset(true);
        });

        doc.addEventListener('touchstart', (event) => {
          const touch = event.touches && event.touches[0];
          if (!touch) return;
          onGestureStart(touch.clientX, touch.clientY);
        }, { passive: true });

        doc.addEventListener('touchmove', (event) => {
          const touch = event.touches && event.touches[0];
          if (!touch) return;
          onGestureMove(touch.clientX, touch.clientY, () => event.preventDefault());
        }, { passive: false });

        doc.addEventListener('touchend', () => {
          onGestureEnd();
        }, { passive: true });

        doc.addEventListener('touchcancel', () => {
          isGestureActive = false;
          isSwipeIntent = false;
          resetTurnOffset(true);
        }, { passive: true });

        doc.addEventListener('mousedown', (event) => {
          if (event.button !== 0) return;
          onGestureStart(event.clientX, event.clientY);
        });

        doc.addEventListener('mousemove', (event) => {
          onGestureMove(event.clientX, event.clientY, () => event.preventDefault());
        });

        doc.addEventListener('mouseup', () => {
          onGestureEnd();
        });
      };

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
            spread: 'auto',
            flow: 'paginated',
            manager: 'default',
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
            emitRelocated(location);
          });

          rendition.on('rendered', (_section, view) => {
            attachSwipeHandlers(view?.document);
          });

          attachSwipeHandlers(document);

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

          postToApp('loading', { message: 'Calculando paginas...' });
          try {
            await book.locations.generate(1200);
            totalVirtualPages = Number(book?.locations?.length?.() || 0);
          } catch {
            totalVirtualPages = Number(book?.locations?.length?.() || 0);
          }

          const metadata = await book.loaded.metadata;
          let coverDataUrl = null;
          try {
            const coverUrl = await book.coverUrl();
            if (coverUrl) {
              const coverResponse = await fetch(coverUrl);
              const coverBlob = await coverResponse.blob();
              coverDataUrl = await blobToDataUrl(coverBlob);
              if (typeof coverUrl === 'string' && coverUrl.startsWith('blob:')) {
                URL.revokeObjectURL(coverUrl);
              }
            }
          } catch {}

          postToApp('metadata', {
            title: metadata?.title || '',
            coverDataUrl: typeof coverDataUrl === 'string' ? coverDataUrl : undefined,
          });
          emitRelocated(rendition.currentLocation?.());
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
        coverUri: null,
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
        setStatusText('Calculando paginas...');
        sendCommand({ type: 'setFontScale', payload: { scale: fontScale } });
        return;
      }

      if (parsed.type === 'metadata') {
        if (parsed.payload?.title) {
          setBookName(parsed.payload.title);
        }
        if (bookId) {
          patchLibraryBook(bookId, {
            ...(parsed.payload?.title ? { title: parsed.payload.title } : null),
            ...(parsed.payload?.coverDataUrl ? { coverUri: parsed.payload.coverDataUrl } : null),
          });
        }
        return;
      }

      if (parsed.type === 'relocated') {
        if (typeof parsed.payload?.percentage === 'number') {
          setProgress(parsed.payload.percentage);
        }
        if (
          typeof parsed.payload?.currentPage === 'number' &&
          typeof parsed.payload?.totalPages === 'number'
        ) {
          setStatusText(`${parsed.payload.currentPage}/${parsed.payload.totalPages}`);
        } else if (typeof parsed.payload?.currentPage === 'number') {
          setStatusText(`${parsed.payload.currentPage}/...`);
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

  const quickAccessBooks = useMemo(
    () => library.slice().sort((a, b) => b.lastOpenedAt - a.lastOpenedAt),
    [library],
  );
  const featuredBooks = useMemo(() => quickAccessBooks.slice(0, 8), [quickAccessBooks]);

  const spineColors = ['#5b3a2b', '#6f5039', '#7d2f2f', '#3f5d57', '#49406a', '#7a5b2f', '#3f4a54'];

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />

      {!bookBase64 ? (
        <>
          <ScrollView contentContainerStyle={styles.homeContent} style={styles.homeScroll}>
            <View style={styles.header}>
              <View style={styles.toolbar}>
                <Text style={styles.libraryTitle}>Biblioteca</Text>
                <Text style={styles.progress}>{quickAccessBooks.length} libros</Text>
              </View>

              <View style={styles.featuredStrip}>
                <Text style={styles.bookTitle} numberOfLines={1}>
                  Continua leyendo
                </Text>
                {featuredBooks.length === 0 ? (
                  <Text style={styles.featuredEmptyText}>
                    Agrega tu primer EPUB para ver portadas aqui.
                  </Text>
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.featuredRow}
                  >
                    {featuredBooks.map((book, index) => (
                      <TouchableOpacity
                        key={book.id}
                        style={styles.featuredCard}
                        onPress={() => openLibraryBook(book)}
                        activeOpacity={0.9}
                      >
                        {book.coverUri ? (
                          <Image
                            source={{ uri: book.coverUri }}
                            style={styles.featuredCoverImage}
                            resizeMode="cover"
                          />
                        ) : (
                          <View
                            style={[
                              styles.featuredCoverFallback,
                              { backgroundColor: spineColors[index % spineColors.length] },
                            ]}
                          >
                            <Text numberOfLines={3} style={styles.featuredCoverText}>
                              {book.title || book.name}
                            </Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </View>
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
                    {book.coverUri ? (
                      <Image source={{ uri: book.coverUri }} style={styles.coverImage} resizeMode="cover" />
                    ) : (
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
                    )}
                    <Text numberOfLines={2} style={styles.cardTitle}>
                      {book.title || book.name}
                    </Text>
                    <Text style={styles.cardMeta}>
                      Progreso: {Math.round((book.progress || 0) * 100)}%
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </ScrollView>
          <TouchableOpacity
            style={[styles.addFab, isPickingFile && styles.addFabDisabled]}
            onPress={pickEpubFile}
            disabled={isPickingFile}
            activeOpacity={0.9}
          >
            <Text style={styles.addFabPlus}>＋</Text>
            <Text style={styles.addFabText}>{isPickingFile ? 'Abriendo...' : 'Agregar'}</Text>
          </TouchableOpacity>
        </>
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
              <Text style={styles.controlsToggleText}>{showControls ? 'Cerrar' : 'Menu'}</Text>
            </TouchableOpacity>
          )}

          {bookReady && (
            <View style={[styles.readerMenu, !showControls && styles.hiddenControls]}>
              <View style={styles.fontRow}>
                <TouchableOpacity style={styles.smallButton} onPress={() => changeFontScale(-0.1)}>
                  <Text style={styles.smallButtonText}>A-</Text>
                </TouchableOpacity>
                <Text style={styles.fontLabel}>{Math.round(fontScale * 100)}%</Text>
                <TouchableOpacity style={styles.smallButton} onPress={() => changeFontScale(0.1)}>
                  <Text style={styles.smallButtonText}>A+</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.exitButton} onPress={goToLibrary}>
                <Text style={styles.exitButtonText}>Salir del libro</Text>
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
    backgroundColor: '#f5f1e8',
  },
  homeScroll: {
    flex: 1,
  },
  homeContent: {
    paddingBottom: 120,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
    gap: 10,
    backgroundColor: '#efe8da',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  libraryTitle: {
    color: '#352c21',
    fontSize: 20,
    fontWeight: '700',
  },
  featuredStrip: {
    borderRadius: 16,
    backgroundColor: '#fffdf8',
    borderWidth: 1,
    borderColor: '#dfd4c0',
    padding: 10,
    gap: 8,
  },
  featuredEmptyText: {
    color: '#7a6d5d',
    fontSize: 13,
  },
  featuredRow: {
    gap: 10,
    paddingRight: 4,
  },
  featuredCard: {
    width: 76,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#d7cab2',
    backgroundColor: '#f1e8d7',
  },
  featuredCoverImage: {
    width: '100%',
    aspectRatio: 0.68,
  },
  featuredCoverFallback: {
    width: '100%',
    aspectRatio: 0.68,
    justifyContent: 'flex-end',
    padding: 6,
  },
  featuredCoverText: {
    color: '#fff7ea',
    fontSize: 10,
    fontWeight: '700',
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
    paddingTop: 14,
  },
  card: {
    width: '30%',
    minWidth: 100,
    maxWidth: 140,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d2c4ae',
    backgroundColor: '#fffdf8',
    padding: 8,
    shadowColor: '#5f4e34',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 3,
  },
  cover: {
    aspectRatio: 0.68,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 10,
    justifyContent: 'flex-end',
  },
  coverImage: {
    width: '100%',
    aspectRatio: 0.68,
    borderRadius: 8,
  },
  coverTitle: {
    color: '#fff4dd',
    fontSize: 12,
    fontWeight: '700',
  },
  cardTitle: {
    color: '#3b3327',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
  },
  cardMeta: {
    color: '#7c6c57',
    fontSize: 11,
    marginTop: 4,
  },
  emptyLibrary: {
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d2c4ae',
    backgroundColor: '#fffdf8',
    padding: 14,
    gap: 6,
  },
  emptyLibraryTitle: {
    color: '#3d3528',
    fontWeight: '700',
    fontSize: 15,
  },
  emptyLibraryText: {
    color: '#7f705b',
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
  hiddenControls: {
    opacity: 0,
  },
  controlsToggle: {
    position: 'absolute',
    right: 16,
    bottom: 22,
    zIndex: 30,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.62)',
    backgroundColor: 'rgba(246, 247, 250, 0.83)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 5,
  },
  controlsToggleText: {
    color: '#1f2530',
    fontSize: 12,
    fontWeight: '600',
  },
  readerMenu: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 70,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.76)',
    backgroundColor: 'rgba(242, 244, 248, 0.9)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 8,
    zIndex: 25,
  },
  fontRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  smallButton: {
    minWidth: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(116, 126, 146, 0.28)',
    backgroundColor: '#ffffff',
    paddingVertical: 9,
    alignItems: 'center',
  },
  smallButtonText: {
    color: '#2a3240',
    fontWeight: '700',
  },
  fontLabel: {
    color: '#293140',
    fontSize: 14,
    fontWeight: '700',
    minWidth: 66,
    textAlign: 'center',
  },
  exitButton: {
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(116, 126, 146, 0.28)',
    paddingVertical: 11,
    alignItems: 'center',
  },
  exitButtonText: {
    color: '#2a3240',
    fontWeight: '600',
    fontSize: 14,
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
    color: '#352c21',
    fontSize: 16,
    fontWeight: '700',
  },
  progress: {
    color: '#6a5b49',
    fontSize: 14,
    fontWeight: '700',
  },
  addFab: {
    position: 'absolute',
    right: 16,
    bottom: 28,
    height: 56,
    borderRadius: 28,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 18,
    elevation: 9,
  },
  addFabDisabled: {
    opacity: 0.66,
  },
  addFabPlus: {
    color: '#f9fafb',
    fontSize: 20,
    fontWeight: '600',
    marginTop: -1,
  },
  addFabText: {
    color: '#f9fafb',
    fontSize: 15,
    fontWeight: '600',
  },
});
