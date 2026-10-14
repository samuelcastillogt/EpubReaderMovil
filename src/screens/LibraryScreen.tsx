import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { styles } from '../ui/styles';
import { LibraryBook } from '../types';

const spineColors = ['#5b3a2b', '#6f5039', '#7d2f2f', '#3f5d57', '#49406a', '#7a5b2f', '#3f4a54'];

type Props = {
  library: LibraryBook[];
  isPickingFile: boolean;
  isPro: boolean;
  dueCount: number;
  streak: number;
  onOpenBook: (book: LibraryBook) => void;
  onPickFile: () => void;
  onOpenReview: () => void;
  onOpenAccount: () => void;
};

export function LibraryScreen({
  library,
  isPickingFile,
  isPro,
  dueCount,
  streak,
  onOpenBook,
  onPickFile,
  onOpenReview,
  onOpenAccount,
}: Props) {
  const quickAccessBooks = library.slice().sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  const featuredBooks = quickAccessBooks.slice(0, 8);
  const openLibraryBook = onOpenBook;
  const pickEpubFile = onPickFile;

  return (
    <>
      <ScrollView contentContainerStyle={styles.homeContent} style={styles.homeScroll}>
        <View style={styles.header}>
          <View style={styles.toolbar}>
            <Text style={styles.libraryTitle}>Biblioteca</Text>
            <Text style={styles.progress}>{quickAccessBooks.length} libros</Text>
          </View>

          <View style={local.studyRow}>
            <TouchableOpacity style={local.reviewButton} onPress={onOpenReview} activeOpacity={0.9}>
              <Text style={local.reviewButtonTitle}>
                {dueCount > 0 ? `Repaso de hoy · ${dueCount}` : 'Repaso de hoy'}
              </Text>
              <Text style={local.reviewButtonMeta}>
                {streak > 0
                  ? `Racha de ${streak} ${streak === 1 ? 'dia' : 'dias'}`
                  : 'Subraya para crear tarjetas'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={local.sideButton} onPress={onOpenAccount} activeOpacity={0.9}>
              <Text style={local.sideButtonText}>{isPro ? 'Pro ✓' : 'Cuenta'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.featuredStrip}>
            <Text style={styles.bookTitle} numberOfLines={1}>
              Continua leyendo
            </Text>
            {featuredBooks.length === 0 ? (
              <Text style={styles.featuredEmptyText}>Agrega tu primer EPUB para ver portadas aqui.</Text>
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
            <Text style={styles.emptyLibraryTitle}>Lee, subraya y recuerda</Text>
            <Text style={styles.emptyLibraryText}>1. Agrega un EPUB con el boton de abajo.</Text>
            <Text style={styles.emptyLibraryText}>
              2. Manten presionado un texto para subrayarlo o anotar una idea.
            </Text>
            <Text style={styles.emptyLibraryText}>
              3. Cada subrayado se vuelve una tarjeta: repasa 5 minutos al dia y no olvides lo que lees.
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
                  <View style={[styles.cover, { backgroundColor: spineColors[index % spineColors.length] }]}>
                    <Text style={styles.coverTitle} numberOfLines={3}>
                      {book.title || book.name}
                    </Text>
                  </View>
                )}
                <Text numberOfLines={2} style={styles.cardTitle}>
                  {book.title || book.name}
                </Text>
                <Text style={styles.cardMeta}>Progreso: {Math.round((book.progress || 0) * 100)}%</Text>
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
  );
}

const local = StyleSheet.create({
  studyRow: { flexDirection: 'row', gap: 8 },
  reviewButton: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: '#111827',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 2,
  },
  reviewButtonTitle: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  reviewButtonMeta: { color: '#f7e5cc', fontSize: 12 },
  sideButton: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dfd4c0',
    backgroundColor: '#fffdf8',
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideButtonText: { color: '#352c21', fontSize: 14, fontWeight: '700' },
});
