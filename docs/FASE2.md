# Lector Epub · Fase 2 (lector de estudio)

Implementa las etapas 1–4 del roadmap: lector offline y medible, validación de pago, repaso espaciado y funciones Pro.

## Qué cambió

| Área | Cambio | Archivos |
| --- | --- | --- |
| Offline | epub.js 0.3.93 y JSZip 3.10.1 embebidos en el WebView; ya no se usa CDN | `scripts/build-reader-vendor.js`, `src/reader/` |
| Arquitectura | `App.tsx` (1,879 líneas) dividido en pantallas, servicios y almacenamiento | `App.tsx`, `src/` |
| Analytics | Eventos a PostHog por API HTTP (sin SDK nativo) | `src/services/analytics.ts` |
| Errores | Handler global + ErrorBoundary → `$exception` en PostHog | `src/services/crash.ts`, `src/ui/ErrorBoundary.tsx` |
| Compras | RevenueCat, entitlement `pro`; sin claves = lista de espera (fake door) | `src/services/purchases.ts`, `src/screens/PaywallScreen.tsx` |
| Subrayados y notas | Mantener presionado → Subrayar / Nota; tocar subrayado → editar o quitar | `src/screens/ReaderScreen.tsx`, `src/storage/highlights.ts` |
| Repaso | SM-2, tarjetas desde subrayados, racha, recordatorio diario 8 p. m. | `src/features/review/`, `src/screens/ReviewScreen.tsx` |
| Resúmenes IA | Menú › Estudio › Resumir capítulo; Edge Function con Claude y cuotas | `src/features/ai/`, `supabase/functions/summarize/` |
| Exportar | Markdown (Notion/Obsidian) y TSV para Anki | `src/features/export/`, `src/screens/NotesScreen.tsx` |
| Respaldo | Correo + código OTP; subrayados, notas, repaso y resúmenes | `src/features/backup.ts`, `src/screens/AccountScreen.tsx` |
| Reseñas | Prompt nativo tras repaso con racha ≥ 3 (máx. 1 cada 90 días) | `src/services/storeReview.ts` |
| Bug corregido | El extracto de búsqueda borraba letras "s" (regex `\s` sin escapar en el template) | `src/reader/readerHtml.ts` |

## Plan gratis vs Pro

| Función | Gratis | Pro |
| --- | --- | --- |
| Lector, temas, índice, búsqueda, subrayados, notas | Sí | Sí |
| Repaso | 10 tarjetas/día, 1 libro | Ilimitado |
| Resumen IA | 1 por libro | 200/mes (uso justo) |
| Exportar Markdown / Anki | No | Sí |
| Respaldo en la nube | No | Sí |

## Puesta en marcha

1. `npm install` (en tu Mac; actualiza `node_modules` con las dependencias nuevas).
2. Copia `.env.example` a `.env.local` y completa las claves que tengas. Todas son opcionales.
3. Como hay módulos nativos nuevos (notificaciones, compras, reseñas), usa un development build: `eas build --profile development --platform android`. Expo Go abre la app, pero compras y notificaciones quedan limitadas.
4. Si actualizas epub.js o JSZip: `npm run vendor:reader`.

### Supabase (respaldo, lista de espera, resúmenes IA)

1. Crea el proyecto y ejecuta `supabase/migrations/20261014000000_fase2.sql`.
2. Authentication › Providers: activa **Anonymous sign-ins** y **Email**. En la plantilla de correo "Magic link" incluye `{{ .Token }}` para que llegue el código de 6 dígitos.
3. `supabase secrets set ANTHROPIC_API_KEY=... REVENUECAT_SECRET_KEY=...` (y opcional `ANTHROPIC_MODEL`).
4. `supabase functions deploy summarize`.

### RevenueCat

1. Productos en Play Console / App Store: mensual (US$2.99), anual (US$19.99, prueba 7 días), de por vida (US$39.99).
2. Entitlement `pro` y una offering "default" con los tres paquetes.
3. Claves públicas en `EXPO_PUBLIC_RC_ANDROID_KEY` / `EXPO_PUBLIC_RC_IOS_KEY`; clave secreta en Supabase para validar Pro en el servidor.

## Eventos de analytics

`install`, `app_open`, `session_start`, `session_end`, `import_book`, `open_book`, `close_book`, `search_in_book`, `highlight_created`, `highlight_removed`, `note_created`, `study_panel_opened`, `review_opened`, `review_card_rated`, `review_session_completed`, `reminder_permission`, `paywall_viewed`, `paywall_cta_tapped`, `waitlist_joined`, `purchase_started`, `purchase_completed`, `purchase_cancelled`, `purchase_failed`, `purchase_restored`, `summary_requested`, `summary_completed`, `summary_failed`, `export_done`, `export_blocked`, `backup_done`, `backup_restored`, `store_review_prompted`, `$exception`.

Métricas de las puertas del roadmap:

- Puerta 2: `paywall_cta_tapped` / usuarios activos ≥ 5 %; `waitlist_joined` / activos ≥ 1 %.
- Puerta 3: usuarios con `review_session_completed` en 3+ días de su primera semana / usuarios con `highlight_created` ≥ 25 %; `purchase_completed` / `install` ≥ 2 %.
- Puerta 4: churn mensual de suscriptores ≤ 8 % (RevenueCat).

## Pendientes conocidos

- El libro sigue pasando completo en base64 al WebView: libros muy grandes pueden consumir mucha memoria.
- Si alguien compra Pro sin sesión y luego entra con otro correo, la compra se vincula con `Purchases.logIn`; revisa la política de transferencia en RevenueCat.
- Notion se cubre con Markdown importable; integración directa por API queda para otra fase.
- PDF, colecciones y filtros (fase 2C) siguen pendientes.
- Probado: TypeScript, bundle de Android y el lector en un navegador sin red (carga, selección, subrayado, texto de capítulo). Falta probar en dispositivo real.
