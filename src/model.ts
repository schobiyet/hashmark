import { randomUUID } from 'node:crypto';

export interface Bookmark {
  id: string;
  file: string;
  line: number;
  note: string;
}

export const UNTAGGED = '(untagged)';

const TAG = /#([\w-]+)/g;

export function tagsOf(note: string): string[] {
  return [...new Set([...note.matchAll(TAG)].map(([, tag = '']) => tag.toLowerCase()))];
}

export function filterBookmarks(list: Bookmark[], filter: string): Bookmark[] {
  const f = filter.trim().toLowerCase();
  if (!f) {
    return list;
  }
  const wanted = tagsOf(f);
  const text = f.replace(TAG, '').trim();
  return list.filter((b) => {
    const tags = tagsOf(b.note);
    return (
      wanted.every((w) => tags.some((t) => t.startsWith(w))) &&
      (!text || `${b.note} ${b.file}`.toLowerCase().includes(text))
    );
  });
}

export function groupByTag(list: Bookmark[]): [string, Bookmark[]][] {
  const groups = new Map<string, Bookmark[]>();
  for (const b of list) {
    const tags = tagsOf(b.note);
    for (const t of tags.length ? tags : [UNTAGGED]) {
      groups.set(t, [...(groups.get(t) ?? []), b]);
    }
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b));
}

export const isAt = (file: string, line: number) => (b: Bookmark) => b.file === file && b.line === line;

export function dedupe(list: Bookmark[]): Bookmark[] {
  const seen = new Set<string>();
  const out = list.filter((b) => {
    const key = `${b.file}#${b.line}`;
    const isNew = !seen.has(key);
    seen.add(key);
    return isNew;
  });
  return out.length === list.length ? list : out;
}

export function upsert(list: Bookmark[], file: string, line: number, note: string): Bookmark[] {
  const existing = list.find(isAt(file, line));
  return [...list.filter((b) => b !== existing), { id: existing?.id ?? randomUUID(), file, line, note: note.trim() }];
}

export function toggle(list: Bookmark[], file: string, line: number): Bookmark[] {
  return list.some(isAt(file, line))
    ? list.filter((b) => !isAt(file, line)(b))
    : [...list, { id: randomUUID(), file, line, note: '' }];
}

export interface LineChange {
  startLine: number;
  startChar: number;
  endLine: number;
  addedLines: number;
}

export function shiftBookmarks(list: Bookmark[], file: string, changes: LineChange[]): Bookmark[] {
  let out = list;
  for (const c of changes) {
    const delta = c.addedLines - (c.endLine - c.startLine);
    if (delta === 0) {
      continue;
    }
    const insertedAtLineStart = c.startLine === c.endLine && c.startChar === 0 && c.addedLines > 0;
    out = out.flatMap((b) => {
      if (b.file !== file) {
        return [b];
      }
      if (b.line > c.endLine || (b.line === c.startLine && insertedAtLineStart)) {
        return [{ ...b, line: b.line + delta }];
      }
      if (b.line > c.startLine + c.addedLines && b.line <= c.endLine) {
        return [];
      }
      return [b];
    });
  }
  const unique = dedupe(out);
  return unique.length === list.length && unique.every((b, i) => b === list[i]) ? list : unique;
}

export function renameKeys(list: Bookmark[], oldKey: string, newKey: string): Bookmark[] {
  let changed = false;
  const out = list.map((b) => {
    if (b.file !== oldKey && !b.file.startsWith(`${oldKey}/`)) {
      return b;
    }
    changed = true;
    return { ...b, file: newKey + b.file.slice(oldKey.length) };
  });
  return changed ? out : list;
}

export function neighbor(list: Bookmark[], file: string, line: number, dir: 1 | -1): Bookmark | undefined {
  const inFile = list.filter((b) => b.file === file).sort((a, b) => a.line - b.line);
  if (!inFile.length) {
    return undefined;
  }
  return dir === 1
    ? (inFile.find((b) => b.line > line) ?? inFile[0])
    : (inFile.findLast((b) => b.line < line) ?? inFile[inFile.length - 1]);
}

export function tagCounts(list: Bookmark[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const b of list) {
    for (const t of tagsOf(b.note)) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
}

const TRAILING_TAG = /#([\w-]*)$/;

export function tagSuggestions(value: string, counts: [string, number][]): [string, number][] {
  const m = value.match(TRAILING_TAG);
  if (!m) {
    return [];
  }
  const fragment = (m[1] ?? '').toLowerCase();
  const used = tagsOf(value.slice(0, m.index));
  return counts.filter(([t]) => t.startsWith(fragment) && t !== fragment && !used.includes(t));
}

export function applyTag(value: string, tag: string): string {
  return value.replace(TRAILING_TAG, `#${tag} `);
}
