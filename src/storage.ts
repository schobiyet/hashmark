import * as vscode from 'vscode';
import type { Bookmark } from './model';
import { parse, serialize } from './serialize';

export interface Backend {
  write(list: Bookmark[]): Thenable<void>;
}

export const STATE_KEY = 'hashmark';

export function mementoStorage(state: vscode.Memento) {
  return {
    read: () =>
      state
        .get<(Bookmark & { uri?: string })[]>(STATE_KEY, [])
        .map(({ uri, ...b }) => ({ ...b, file: b.file ?? uri ?? '' })),
    write: (list: Bookmark[]) => state.update(STATE_KEY, list),
  };
}

export class FileStorage implements Backend {
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
