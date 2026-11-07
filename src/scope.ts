import { type Bookmark, dedupe, groupBy } from './model';

export const isUnder = (folder: string, file: string) =>
  file === folder || file.startsWith(folder.endsWith('/') ? folder : `${folder}/`);

export function replaceUnder(list: Bookmark[], folder: string, incoming: Bookmark[]): Bookmark[] {
  return dedupe([...list.filter((b) => !isUnder(folder, b.file)), ...incoming]);
}

export type FolderChange = {
  folder: string;
  bookmarks: Bookmark[] | undefined;
};

export const applyChanges = (list: Bookmark[], changes: FolderChange[]) =>
  changes.reduce((acc, c) => replaceUnder(acc, c.folder, c.bookmarks ?? []), list);

export const splitBy = (list: Bookmark[], ownerOf: (file: string) => string | undefined) =>
  groupBy(list, (b) => [ownerOf(b.file)]);

export function groupByFolder(list: Bookmark[], folders: string[]): [string | undefined, Bookmark[]][] {
  const groups = splitBy(list, (file) => folders.find((f) => isUnder(f, file)));
  const out: [string | undefined, Bookmark[]][] = [];
  for (const folder of [...folders, undefined]) {
    const items = groups.get(folder);
    if (items) {
      out.push([folder, items]);
    }
  }
  return out;
}
