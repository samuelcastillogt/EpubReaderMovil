// HTML del lector que corre dentro del WebView.
// epub.js y JSZip van embebidos (vendor.generated.ts): el lector funciona sin internet.
import { EPUBJS_SOURCE, JSZIP_SOURCE } from './vendor.generated';

export const READER_HTML = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script>${JSZIP_SOURCE}</script>
    <script>${EPUBJS_SOURCE}</script>
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
      let readingSettings = {
        fontScale: 1,
        lineHeight: 1.6,
        margin: 22,
        theme: 'sepia',
      };

      const themeTokens = {
        light: { foreground: '#1f2933', background: '#fbfaf7', link: '#365f91' },
        sepia: { foreground: '#1d1b18', background: '#f6f1e8', link: '#7a4b2a' },
        dark: { foreground: '#e8e0d2', background: '#171819', link: '#9dc3ff' },
      };

      const SWIPE_MIN_PX = 56;
      const SWIPE_TRIGGER_RATIO = 0.18;
      const SWIPE_RESISTANCE = 0.48;
      const TURN_OFFSET_RATIO = 0.2;

      const getViewer = () => document.getElementById('viewer');
      const getShadow = () => document.getElementById('pageShadow');
      const getCurl = () => document.getElementById('pageCurl');

      const applyReadingSettings = (settings) => {
        readingSettings = {
          ...readingSettings,
          ...settings,
          fontScale: Math.min(1.8, Math.max(0.8, Number(settings?.fontScale || readingSettings.fontScale))),
          lineHeight: Math.min(2.2, Math.max(1.2, Number(settings?.lineHeight || readingSettings.lineHeight))),
          margin: Math.min(56, Math.max(8, Number(settings?.margin || readingSettings.margin))),
          theme: themeTokens[settings?.theme] ? settings.theme : readingSettings.theme,
        };

        const tokens = themeTokens[readingSettings.theme] || themeTokens.sepia;
        document.documentElement.style.background = tokens.background;
        document.body.style.background = tokens.background;
        const loader = document.getElementById('loader');
        if (loader) {
          loader.style.color = tokens.foreground;
          loader.style.background = tokens.background;
        }

        if (!rendition) return;
        rendition.themes.default({
          body: {
            'font-family': "Georgia, 'Times New Roman', serif",
            'font-size': Math.round(readingSettings.fontScale * 100) + '%',
            'line-height': String(readingSettings.lineHeight),
            color: tokens.foreground,
            background: tokens.background,
            padding: '0 ' + readingSettings.margin + 'px !important',
          },
          p: {
            'line-height': String(readingSettings.lineHeight),
          },
          a: {
            color: tokens.link,
          },
        });
        rendition.themes.fontSize(Math.round(readingSettings.fontScale * 100) + '%');
        rendition.themes.override('color', tokens.foreground, true);
        rendition.themes.override('background', tokens.background, true);
      };

      const flattenToc = (items, level = 0) => {
        if (!Array.isArray(items)) return [];
        return items.flatMap((item, index) => {
          const href = String(item?.href || '').trim();
          const label = String(item?.label || item?.title || href || 'Seccion').trim();
          const children = flattenToc(item?.subitems || item?.children, level + 1);
          if (!href) return children;
          return [
            {
              id: href + '-' + level + '-' + index,
              label,
              href,
              level,
            },
            ...children,
          ];
        });
      };

      const emitToc = async () => {
        try {
          const navigation = await book?.loaded?.navigation;
          tocCache = flattenToc(navigation?.toc);
          postToApp('toc', { items: tocCache.slice(0, 80) });
        } catch {
          postToApp('toc', { items: [] });
        }
      };

      const searchBook = async (query) => {
        const normalizedQuery = String(query || '').trim();
        if (!book || normalizedQuery.length < 2) {
          postToApp('searchResults', { query: normalizedQuery, results: [] });
          return;
        }

        const spineItems = book.spine?.spineItems || [];
        const results = [];
        for (const section of spineItems) {
          if (results.length >= 40) break;
          try {
            await section.load(book.load.bind(book));
            const matches = section.find(normalizedQuery) || [];
            for (const match of matches) {
              const excerpt = String(match?.excerpt || '').replace(/\\s+/g, ' ').trim();
              const cfi = String(match?.cfi || '').trim();
              if (!cfi) continue;
              results.push({
                id: cfi,
                label: section?.label || section?.href || 'Resultado',
                excerpt,
                cfi,
              });
              if (results.length >= 40) break;
            }
          } catch {
          } finally {
            try {
              section.unload();
            } catch {}
          }
        }

        postToApp('searchResults', { query: normalizedQuery, results });
      };

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
          href: location?.start?.href || undefined,
          chapter: chapterLabelForHref(location?.start?.href),
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
        if (hasActiveSelection()) return;

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

          applyReadingSettings(readingSettings);

          rendition.on('relocated', (location) => {
            emitRelocated(location);
          });

          rendition.on('rendered', (_section, view) => {
            attachSwipeHandlers(view?.document);
          });

          rendition.on('selected', (cfiRange, contents) => {
            onTextSelected(cfiRange, contents);
          });

          appliedHighlights = new Set();

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
          applyHighlights(pendingHighlights);
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
          await emitToc();
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

      // ---- Fase 2: subrayados, notas y texto de capitulo ----
      let tocCache = [];
      let pendingHighlights = [];
      let appliedHighlights = new Set();

      const normalizeHref = (href) => String(href || '').split('#')[0].replace(/^\\.?\\//, '');

      const chapterLabelForHref = (href) => {
        const target = normalizeHref(href);
        if (!target) return undefined;
        const match = tocCache.find((item) => {
          const itemHref = normalizeHref(item.href);
          return itemHref === target || itemHref.endsWith(target) || target.endsWith(itemHref);
        });
        return match ? match.label : undefined;
      };

      const hasActiveSelection = () => {
        try {
          const contents = rendition?.getContents?.() || [];
          return contents.some((content) => {
            const selection = content?.window?.getSelection?.();
            return Boolean(selection && String(selection).trim().length > 0);
          });
        } catch {
          return false;
        }
      };

      const clearSelection = () => {
        try {
          (rendition?.getContents?.() || []).forEach((content) => {
            content?.window?.getSelection?.()?.removeAllRanges?.();
          });
        } catch {}
      };

      const onTextSelected = (cfiRange, contents) => {
        try {
          const range = rendition.getRange(cfiRange);
          const text = String(range ? range.toString() : '').replace(/\\s+/g, ' ').trim();
          if (text.length < 3) return;
          const location = rendition.currentLocation?.();
          const href = location?.start?.href;
          postToApp('selection', {
            cfi: cfiRange,
            text: text.slice(0, 2000),
            href,
            chapter: chapterLabelForHref(href),
          });
        } catch {}
      };

      const addHighlight = (cfi) => {
        if (!rendition || !cfi || appliedHighlights.has(cfi)) return;
        try {
          rendition.annotations.highlight(
            cfi,
            {},
            () => postToApp('highlightTapped', { cfi }),
            'epub-hl',
            { fill: '#f2c94c', 'fill-opacity': '0.38', 'mix-blend-mode': 'multiply' },
          );
          appliedHighlights.add(cfi);
        } catch {}
      };

      const removeHighlight = (cfi) => {
        if (!rendition || !cfi) return;
        try {
          rendition.annotations.remove(cfi, 'highlight');
        } catch {}
        appliedHighlights.delete(cfi);
      };

      const applyHighlights = (items) => {
        pendingHighlights = Array.isArray(items) ? items : [];
        if (!rendition) return;
        pendingHighlights.forEach((item) => addHighlight(item?.cfi));
      };

      const sendChapterText = async (requestId) => {
        if (!book || !rendition) {
          postToApp('chapterText', { requestId, error: 'No hay libro abierto' });
          return;
        }
        const location = rendition.currentLocation?.();
        const href = location?.start?.href;
        const section = href ? book.spine.get(href) : null;
        if (!section) {
          postToApp('chapterText', { requestId, error: 'No se encontro el capitulo actual' });
          return;
        }
        try {
          await section.load(book.load.bind(book));
          const body = section.document?.body;
          const text = String(body ? body.textContent || '' : '').replace(/\\s+/g, ' ').trim();
          postToApp('chapterText', {
            requestId,
            href: normalizeHref(href),
            chapter: chapterLabelForHref(href) || section.label || 'Capitulo',
            text: text.slice(0, 60000),
          });
        } catch (error) {
          postToApp('chapterText', {
            requestId,
            error: error instanceof Error ? error.message : 'No se pudo leer el capitulo',
          });
        } finally {
          try {
            section.unload();
          } catch {}
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
            case 'setReadingSettings':
              applyReadingSettings(message.payload);
              break;
            case 'goTo':
              if (rendition && message.payload?.target) {
                await rendition.display(message.payload.target);
              }
              break;
            case 'search':
              await searchBook(message.payload?.query);
              break;
            case 'setHighlights':
              applyHighlights(message.payload?.items);
              break;
            case 'addHighlight':
              addHighlight(message.payload?.cfi);
              clearSelection();
              break;
            case 'removeHighlight':
              removeHighlight(message.payload?.cfi);
              break;
            case 'clearSelection':
              clearSelection();
              break;
            case 'getChapterText':
              await sendChapterText(message.payload?.requestId);
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
