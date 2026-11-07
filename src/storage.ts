import * as vscode from 'vscode';
import type { Bookmark } from './model';
import { fromRelative, migrateKey, toRelative } from './paths';
import { type FolderChange, isUnder, splitBy } from './scope';
import { parse, serialize } from './serialize';

export interface Backend {
  write(list: Bookmark[]): Thenable<void>;
}

export const STATE_KEY = 'hashmark';

export class FileStorage {
  private last = '';

  constructor(private uri: vscode.Uri) {}

  private async text(): Promise<string | undefined> {
    try {
      return new TextDecoder().decode(await vscode.workspace.fs.readFile(this.uri));
    } catch {
      return undefined;
    }
  }

  async read(): Promise<Bookmark[] | undefined> {
    const text = await this.text();
    if (text === undefined) {
      return undefined;
    }
    const list = parse(text);
    this.last = text;
    return list;
  }

  async write(list: Bookmark[]) {
    if (!list.length && !this.last) {
      return;
    }
    const text = serialize(list);
    if (text === this.last) {
      return;
    }
    this.last = text;
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.uri, '..'));
    await vscode.workspace.fs.writeFile(this.uri, new TextEncoder().encode(text));
  }

  watch(onChange: (list: Bookmark[]) => void, onInvalid: (err: unknown) => void): vscode.Disposable {
    const dir = vscode.Uri.joinPath(this.uri, '..');
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dir, 'bookmarks.json'));
    const reload = async () => {
      const text = await this.text();
      if (text === undefined || text === this.last) {
        return;
      }
      try {
        const list = parse(text);
        this.last = text;
        onChange(list);
      } catch (err) {
        onInvalid(err);
      }
    };
    return vscode.Disposable.from(
      watcher,
      watcher.onDidChange(reload),
      watcher.onDidCreate(reload),
      watcher.onDidDelete(() => {
        this.last = '';
      }),
    );
  }
}

const absolute = (folder: vscode.Uri, list: Bookmark[]) =>
  list.map((b) => ({ ...b, file: fromRelative(folder, b.file) }));
const relative = (folder: vscode.Uri, list: Bookmark[]) =>
  list.map((b) => ({ ...b, file: toRelative(folder, b.file) }));

type Tracked = {
  folder: vscode.Uri;
  file: FileStorage;
  active: boolean;
  watch?: vscode.Disposable;
};

export class Persistence implements Backend, vscode.Disposable {
  private tracked = new Map<string, Tracked>();

  constructor(
    private state: vscode.Memento,
    private onExternal: (folder: string, list: Bookmark[]) => void,
    private warn: (message: string) => void,
  ) {}

  readMemento(): Bookmark[] {
    return this.state.get<Bookmark[]>(STATE_KEY, []).map((b) => ({ ...b, file: migrateKey(b.file) }));
  }

  async write(list: Bookmark[]) {
    const active = [...this.tracked].filter(([, t]) => t.active);
    const groups = splitBy(list, (file) => active.find(([folder]) => isUnder(folder, file))?.[0]);
    await Promise.all([
      this.state.update(STATE_KEY, groups.get(undefined) ?? []),
      ...active.map(([key, t]) => t.file.write(relative(t.folder, groups.get(key) ?? []))),
    ]);
  }

  async sync(): Promise<FolderChange[]> {
    const changes: FolderChange[] = [];
    const folders = vscode.workspace.workspaceFolders ?? [];
    const wanted = new Map(
      folders
        .filter((f) => vscode.workspace.getConfiguration('hashmark', f.uri).get<boolean>('saveToFile', false))
        .map((f) => [f.uri.toString(), f]),
    );

    for (const [key, t] of this.tracked) {
      if (wanted.has(key)) {
        continue;
      }
      t.watch?.dispose();
      this.tracked.delete(key);
      if (!folders.some((f) => f.uri.toString() === key)) {
        changes.push({ folder: key, bookmarks: undefined });
      }
    }

    for (const [key, folder] of wanted) {
      if (this.tracked.has(key)) {
        continue;
      }
      const t: Tracked = {
        folder: folder.uri,
        file: new FileStorage(vscode.Uri.joinPath(folder.uri, '.vscode', 'bookmarks.json')),
        active: false,
      };
      this.tracked.set(key, t);
      const invalid = (err: unknown) =>
        this.warn(`Hashmark: ${folder.name}/.vscode/bookmarks.json is invalid (${err}). Keeping current bookmarks.`);
      try {
        const existing = await t.file.read();
        if (existing) {
          changes.push({ folder: key, bookmarks: absolute(folder.uri, existing) });
        }
        t.active = true;
      } catch (err) {
        invalid(err);
      }
      t.watch = t.file.watch((fromFile) => {
        t.active = true;
        this.onExternal(key, absolute(folder.uri, fromFile));
      }, invalid);
    }
    return changes;
  }

  dispose() {
    for (const t of this.tracked.values()) {
      t.watch?.dispose();
    }
    this.tracked.clear();
  }
}
