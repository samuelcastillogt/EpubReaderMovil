// Exportacion de subrayados, notas y resumenes. Markdown se importa directo en Notion
// (Importar > Markdown) y en Obsidian; el TSV se importa en Anki (Archivo > Importar).
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';
import { ChapterSummary, Highlight } from '../../types';

const safeName = (value: string) =>
  value
    .replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ _-]/g, '')
    .trim()
    .slice(0, 60) || 'libro';

export function toMarkdown(bookTitle: string, highlights: Highlight[], summaries: ChapterSummary[]) {
  const lines: string[] = [`# ${bookTitle}`, '', `Exportado el ${new Date().toLocaleDateString('es')}`, ''];
  if (summaries.length) {
    lines.push('## Resumenes por capitulo', '');
    for (const summary of summaries) {
      lines.push(`### ${summary.chapter}`, '', summary.summary.trim(), '');
    }
  }
  lines.push('## Subrayados y notas', '');
  const byChapter = new Map<string, Highlight[]>();
  for (const item of [...highlights].sort((a, b) => a.createdAt - b.createdAt)) {
    const key = item.chapter || 'Sin capitulo';
    byChapter.set(key, [...(byChapter.get(key) ?? []), item]);
  }
  for (const [chapter, items] of byChapter) {
    lines.push(`### ${chapter}`, '');
    for (const item of items) {
      lines.push(`> ${item.text.replace(/\n+/g, ' ')}`, '');
      if (item.note) lines.push(`**Nota:** ${item.note}`, '');
    }
  }
  return lines.join('\n');
}

const tsvCell = (value: string) => value.replace(/[\t\r\n]+/g, ' ').trim();

export function toAnkiTsv(bookTitle: string, highlights: Highlight[]) {
  const rows = ['#separator:tab', '#html:false', '#columns:Frente\tReverso\tEtiquetas'];
  for (const item of highlights) {
    const front = item.note
      ? item.note
      : `${bookTitle}${item.chapter ? ` — ${item.chapter}` : ''}: ¿cual es la idea?`;
    rows.push(
      [
        tsvCell(front),
        tsvCell(item.text),
        tsvCell(`lector-epub ${safeName(bookTitle).replace(/ /g, '_')}`),
      ].join('\t'),
    );
  }
  return rows.join('\n');
}

export async function shareTextFile(fileName: string, content: string, mimeType: string) {
  const uri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType, dialogTitle: fileName });
  } else {
    await Share.share({ message: content, title: fileName });
  }
}

export const exportFileName = (bookTitle: string, ext: string) => `${safeName(bookTitle)}.${ext}`;
