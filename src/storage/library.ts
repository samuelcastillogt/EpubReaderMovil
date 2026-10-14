import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { LibraryBook, ReadingSettings } from '../types';
import { readJson, writeJson } from './json';

export const LIBRARY_STORAGE_KEY = 'epub:library:v1';
export const READING_SETTINGS_STORAGE_KEY = 'epub:readingSettings:v1';
const BOOKS_DIR_NAME = 'books';

export const DEFAULT_READING_SETTINGS: ReadingSettings = {
  fontScale: 1,
  lineHeight: 1.6,
  margin: 22,
  theme: 'sepia',
};

export const bookIdFromFile = (name: string, size?: number) =>
  `${name || 'book'}|${size || 0}`.replace(/[^a-zA-Z0-9|._-]/g, '_');

const fileNameFromBookId = (bookId: string) => `${encodeURIComponent(bookId)}.epub`;

export const clampSettings = (
  value: Partial<ReadingSettings>,
  prev = DEFAULT_READING_SETTINGS,
): ReadingSettings => ({
  fontScale: Math.min(1.8, Math.max(0.8, Number(Number(value.fontScale ?? prev.fontScale).toFixed(2)))),
  lineHeight: Math.min(2.2, Math.max(1.2, Number(Number(value.lineHeight ?? prev.lineHeight).toFixed(2)))),
  margin: Math.min(56, Math.max(8, Math.round(Number(value.margin ?? prev.margin)))),
  theme:
    value.theme === 'light' || value.theme === 'dark' || value.theme === 'sepia' ? value.theme : prev.theme,
});

export const loadLibrary = async () => {
  const parsed = await readJson<LibraryBook[]>(LIBRARY_STORAGE_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
};

export const saveLibrary = (books: LibraryBook[]) => writeJson(LIBRARY_STORAGE_KEY, books);

export const loadReadingSettings = async () =>
  clampSettings(
    await readJson<Partial<ReadingSettings>>(READING_SETTINGS_STORAGE_KEY, DEFAULT_READING_SETTINGS),
  );

export const saveReadingSettings = (settings: ReadingSettings) =>
  writeJson(READING_SETTINGS_STORAGE_KEY, settings);

export const positionKey = (bookId: string) => `epub:position:${bookId}`;
export const loadPosition = (bookId: string) => AsyncStorage.getItem(positionKey(bookId));
export const savePosition = (bookId: string, cfi: string) => AsyncStorage.setItem(positionKey(bookId), cfi);

/** Copia el EPUB elegido al almacenamiento de la app y devuelve la entrada de biblioteca. */
export async function persistPickedBook(file: { uri: string; name?: string | null; size?: number | null }) {
  const resolvedBookId = bookIdFromFile(file.name || 'book', file.size ?? undefined);
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

  const entry: LibraryBook = {
    id: resolvedBookId,
    name: file.name || 'Libro sin titulo',
    title: file.name || 'Libro sin titulo',
    uri: persistedUri,
    coverUri: null,
    progress: 0,
    lastOpenedAt: Date.now(),
  };
  return entry;
}

export async function readBookBase64(entry: LibraryBook) {
  const info = await FileSystem.getInfoAsync(entry.uri);
  if (!info.exists) return null;
  return FileSystem.readAsStringAsync(entry.uri, { encoding: FileSystem.EncodingType.Base64 });
}
