import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { exportFileName, shareTextFile, toAnkiTsv, toMarkdown } from '../features/export/exporters';
import { track } from '../services/analytics';
import { captureException } from '../services/crash';
import {
  highlightsForBook,
  onHighlightsChanged,
  removeHighlight,
  updateHighlight,
} from '../storage/highlights';
import { summariesForBook } from '../storage/summaries';
import { ChapterSummary, Highlight } from '../types';
import { Button, Card, kit, ScreenHeader } from '../ui/kit';

type Props = {
  bookId: string;
  bookTitle: string;
  isPro: boolean;
  onBack: () => void;
  onOpenPaywall: (source: string) => void;
};

export function NotesScreen({ bookId, bookTitle, isPro, onBack, onOpenPaywall }: Props) {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [summaries, setSummaries] = useState<ChapterSummary[]>([]);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [tab, setTab] = useState<'highlights' | 'summaries'>('highlights');

  const load = useCallback(async () => {
    const [items, sums] = await Promise.all([highlightsForBook(bookId), summariesForBook(bookId)]);
    setHighlights(items.sort((a, b) => a.createdAt - b.createdAt));
    setSummaries(sums);
  }, [bookId]);

  useEffect(() => {
    void load();
    const unsubscribe = onHighlightsChanged(() => void load());
    return () => {
      unsubscribe();
    };
  }, [load]);

  const doExport = async (format: 'markdown' | 'anki') => {
    if (!isPro) {
      track('export_blocked', { format });
      onOpenPaywall(`export_${format}`);
      return;
    }
    try {
      if (format === 'markdown') {
        await shareTextFile(
          exportFileName(bookTitle, 'md'),
          toMarkdown(bookTitle, highlights, summaries),
          'text/markdown',
        );
      } else {
        await shareTextFile(exportFileName(bookTitle, 'txt'), toAnkiTsv(bookTitle, highlights), 'text/plain');
      }
      track('export_done', { format, highlights: highlights.length });
    } catch (error) {
      captureException(error, { where: 'export' });
      Alert.alert('Error', 'No se pudo exportar.');
    }
  };

  return (
    <View style={kit.screen}>
      <ScreenHeader title={bookTitle} onBack={onBack} />
      <ScrollView contentContainerStyle={kit.content}>
        <View style={kit.row}>
          <Button
            label={`Subrayados (${highlights.length})`}
            variant={tab === 'highlights' ? 'primary' : 'secondary'}
            onPress={() => setTab('highlights')}
            style={{ flex: 1 }}
          />
          <Button
            label={`Resumenes (${summaries.length})`}
            variant={tab === 'summaries' ? 'primary' : 'secondary'}
            onPress={() => setTab('summaries')}
            style={{ flex: 1 }}
          />
        </View>

        <Card>
          <Text style={kit.subtitle}>Exportar{isPro ? '' : ' · Pro'}</Text>
          <Text style={kit.muted}>
            Markdown se importa en Notion (Importar › Markdown) y Obsidian. El archivo de Anki se importa con
            Archivo › Importar.
          </Text>
          <View style={kit.row}>
            <Button
              label="Markdown / Notion"
              variant="secondary"
              onPress={() => void doExport('markdown')}
              style={{ flex: 1 }}
            />
            <Button
              label="Anki"
              variant="secondary"
              onPress={() => void doExport('anki')}
              style={{ flex: 1 }}
            />
          </View>
        </Card>

        {tab === 'summaries' ? (
          summaries.length === 0 ? (
            <Text style={kit.muted}>
              Aun no hay resumenes. En el lector abre Menu › Estudio › “Resumir este capitulo”.
            </Text>
          ) : (
            summaries.map((summary) => (
              <Card key={summary.key}>
                <Text style={kit.subtitle}>{summary.chapter}</Text>
                <Text style={kit.body}>{summary.summary}</Text>
              </Card>
            ))
          )
        ) : highlights.length === 0 ? (
          <Text style={kit.muted}>
            Aun no hay subrayados. Manten presionado un pasaje en el lector para crear uno.
          </Text>
        ) : (
          highlights.map((item) => (
            <Card key={item.id}>
              {item.chapter ? <Text style={kit.muted}>{item.chapter}</Text> : null}
              <Text style={kit.quote}>{item.text}</Text>
              {editing?.id === item.id ? (
                <>
                  <TextInput
                    value={editing.text}
                    onChangeText={(text) => setEditing({ id: item.id, text })}
                    placeholder="Escribe tu nota"
                    placeholderTextColor="#8b8172"
                    multiline
                    style={[kit.input, { minHeight: 80, textAlignVertical: 'top' }]}
                  />
                  <View style={kit.row}>
                    <Button label="Cancelar" variant="ghost" onPress={() => setEditing(null)} />
                    <Button
                      label="Guardar"
                      onPress={async () => {
                        await updateHighlight(item.id, { note: editing.text.trim() || undefined });
                        if (editing.text.trim()) track('note_created', { from: 'notes_screen' });
                        setEditing(null);
                      }}
                    />
                  </View>
                </>
              ) : (
                <>
                  {item.note ? <Text style={kit.body}>📝 {item.note}</Text> : null}
                  <View style={kit.row}>
                    <TouchableOpacity onPress={() => setEditing({ id: item.id, text: item.note || '' })}>
                      <Text style={kit.muted}>{item.note ? 'Editar nota' : 'Agregar nota'}</Text>
                    </TouchableOpacity>
                    <Text style={kit.muted}>·</Text>
                    <TouchableOpacity
                      onPress={() =>
                        Alert.alert('Quitar subrayado', 'Tambien se quitara de tu repaso.', [
                          { text: 'Cancelar', style: 'cancel' },
                          {
                            text: 'Quitar',
                            style: 'destructive',
                            onPress: async () => {
                              await removeHighlight(item.id);
                              track('highlight_removed', { from: 'notes_screen' });
                            },
                          },
                        ])
                      }
                    >
                      <Text style={kit.muted}>Quitar</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </Card>
          ))
        )}
      </ScrollView>
    </View>
  );
}
