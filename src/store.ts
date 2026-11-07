import * as vscode from 'vscode';
import { type Bookmark, filterBookmarks } from './model';
import { toUri } from './paths';
import type { Backend } from './storage';

export class Store {
  private filter = '';
  private missing = new Set<string>();
  private emitter = new vscode.EventEmitter<void>();
  private failing = false;
  readonly onChange = this.emitter.event;

  constructor(
    private list: Bookmark[],
    private readonly backend: Backend,
    private readonly onSaveError: (err: unknown) => void = console.error,
  ) {}

  dispose() {
    this.emitter.dispose();
  }

  replace(list: Bookmark[]) {
    this.list = list;
    this.emitter.fire();
    void this.refreshMissing();
  }

  all(): Bookmark[] {
    return this.list;
  }
  filtered(): Bookmark[] {
    return filterBookmarks(this.list, this.filter);
  }
  getFilter(): string {
    return this.filter;
  }
  isMissing(key: string): boolean {
    return this.missing.has(key);
  }

  async refreshMissing() {
    const gone = new Set<string>();
    await Promise.all(
      [...new Set(this.list.map((b) => b.file))].map(async (key) => {
        const uri = toUri(key);
        if (uri.scheme !== 'file') {
          return;
        }
        try {
          await vscode.workspace.fs.stat(uri);
        } catch {
          gone.add(key);
        }
      }),
    );
    if (gone.size !== this.missing.size || [...gone].some((k) => !this.missing.has(k))) {
      this.missing = gone;
      this.emitter.fire();
    }
  }

  setFilter(f: string) {
    this.filter = f.trim();
    this.emitter.fire();
  }

  async update(change: (list: Bookmark[]) => Bookmark[]) {
    const next = change(this.list);
    if (next !== this.list) {
      await this.save(next);
    }
  }

  async save(list: Bookmark[]) {
    this.list = list;
    try {
      await this.backend.write(list);
      this.failing = false;
    } catch (err) {
      if (!this.failing) {
        this.failing = true;
        this.onSaveError(err);
      }
    }
    this.emitter.fire();
    await this.refreshMissing();
  }
}
