import { randomUUID } from 'node:crypto';
import { type Bookmark, dedupe } from './model';

const VERSION = 1;

export function serialize(list: Bookmark[]): string {
  const rows = list
    .map((b) => ({ file: b.file, line: b.line, note: b.note }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return `${JSON.stringify({ version: VERSION, bookmarks: rows }, null, 2)}\n`;
}

export function parse(text: string): Bookmark[] {
  const data = JSON.parse(text);
  if (data?.version !== VERSION || !Array.isArray(data.bookmarks)) {
    throw new Error('not a version 1 bookmarks file');
  }
  return dedupe(
    data.bookmarks.map((r: Record<string, unknown>): Bookmark => {
      if (
        typeof r?.file !== 'string' ||
        !Number.isInteger(r.line) ||
        (r.line as number) < 0 ||
        typeof r.note !== 'string'
      ) {
        throw new Error(`invalid bookmark entry: ${JSON.stringify(r)}`);
      }
      return {
        id: randomUUID(),
        file: r.file,
        line: r.line as number,
        note: r.note,
      };
    }),
  );
}
