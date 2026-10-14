export type ReaderTheme = 'light' | 'sepia' | 'dark';

export type ReadingSettings = {
  fontScale: number;
  lineHeight: number;
  margin: number;
  theme: ReaderTheme;
};

export type TocItem = {
  id: string;
  label: string;
  href: string;
  level: number;
};

export type SearchResult = {
  id: string;
  label: string;
  excerpt: string;
  cfi: string;
};

export type HighlightRef = { cfi: string };

export type WebCommand =
  | { type: 'loadBook'; payload: { base64: string; startCfi?: string | null } }
  | { type: 'setReadingSettings'; payload: ReadingSettings }
  | { type: 'goTo'; payload: { target: string } }
  | { type: 'search'; payload: { query: string } }
  | { type: 'setHighlights'; payload: { items: HighlightRef[] } }
  | { type: 'addHighlight'; payload: { cfi: string } }
  | { type: 'removeHighlight'; payload: { cfi: string } }
  | { type: 'clearSelection' }
  | { type: 'getChapterText'; payload: { requestId: string } };

export type TextSelection = {
  cfi: string;
  text: string;
  href?: string;
  chapter?: string;
};

export type ReaderEvent =
  | { type: 'ready' }
  | { type: 'metadata'; payload?: { title?: string; coverDataUrl?: string } }
  | { type: 'toc'; payload?: { items?: TocItem[] } }
  | { type: 'searchResults'; payload?: { query?: string; results?: SearchResult[] } }
  | {
      type: 'relocated';
      payload?: {
        percentage?: number;
        cfi?: string;
        href?: string;
        chapter?: string;
        currentPage?: number;
        totalPages?: number;
      };
    }
  | { type: 'selection'; payload?: TextSelection }
  | { type: 'highlightTapped'; payload?: { cfi?: string } }
  | {
      type: 'chapterText';
      payload?: { requestId?: string; href?: string; chapter?: string; text?: string; error?: string };
    }
  | { type: 'loading'; payload?: { message?: string } }
  | { type: 'error'; payload?: { message?: string } };

export type LibraryBook = {
  id: string;
  name: string;
  title: string;
  uri: string;
  coverUri?: string | null;
  progress: number;
  lastOpenedAt: number;
};

export type Highlight = {
  id: string;
  bookId: string;
  bookTitle: string;
  cfi: string;
  text: string;
  note?: string;
  chapter?: string;
  createdAt: number;
  updatedAt: number;
};

export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy';

export type CardState = {
  id: string; // = highlight id
  ease: number;
  intervalDays: number;
  reps: number;
  lapses: number;
  due: number;
  lastReviewedAt?: number;
};

export type ChapterSummary = {
  key: string; // bookId|href
  bookId: string;
  href: string;
  chapter: string;
  summary: string;
  createdAt: number;
};

export type Screen =
  | { name: 'library' }
  | { name: 'reader'; book: LibraryBook }
  | { name: 'review' }
  | { name: 'notes'; bookId: string; bookTitle: string }
  | { name: 'paywall'; source: string }
  | { name: 'account' };
