import * as vscode from 'vscode';
import { registerGutter } from './gutter';
import {
  type Bookmark,
  groupByTag,
  isAt,
  neighbor,
  renameKeys,
  shiftBookmarks,
  tagCounts,
  toggle,
  UNTAGGED,
  upsert,
} from './model';
import { promptNote } from './noteInput';
import { lineRange, rowText, toKey, toUri } from './paths';
import { FileStorage, mementoStorage } from './storage';
import { Store } from './store';
import { type Node, Tree } from './tree';

export interface Api {
  store: Store;
  tree: Tree;
}

const bmFrom = (n?: Node): Bookmark | undefined => (n?.kind === 'bm' ? n.bm : undefined);

const reveal = (bm: Bookmark) =>
  vscode.window.showTextDocument(toUri(bm.file), {
    selection: lineRange(bm.line),
  });

const here = () => {
  const ed = vscode.window.activeTextEditor;
  return ed && { ed, key: toKey(ed.document.uri), line: ed.selection.active.line };
};

export async function activate(ctx: vscode.ExtensionContext): Promise<Api> {
  const memento = mementoStorage(ctx.workspaceState);
  const store = new Store(memento.read(), memento);
  const tree = new Tree(store);
  const view = vscode.window.createTreeView('bookmark.view', {
    treeDataProvider: tree,
  });
  const syncMessage = () => {
    view.message = store.getFilter() ? `Filter: ${store.getFilter()}` : undefined;
  };
  ctx.subscriptions.push(store, store.onChange(syncMessage));

  const reg = <A extends unknown[]>(id: string, fn: (...args: A) => unknown) =>
    ctx.subscriptions.push(vscode.commands.registerCommand(`bookmark.${id}`, fn));

  reg('add', async () => {
    const at = here();
    if (!at) {
      return;
    }
    const existing = store.all().find(isAt(at.key, at.line));
    const note = await promptNote('Bookmark note', existing?.note ?? '', () => tagCounts(store.all()));
    if (note !== undefined) {
      await store.update((l) => upsert(l, at.key, at.line, note));
    }
  });

  reg('toggle', async () => {
    const at = here();
    if (at) {
      await store.update((l) => toggle(l, at.key, at.line));
    }
  });

  const step = (dir: 1 | -1) => () => {
    const at = here();
    if (!at) {
      return;
    }
    const bm = neighbor(store.all(), at.key, at.line, dir);
    if (!bm) {
      vscode.window.setStatusBarMessage('No bookmarks in this file', 2000);
      return;
    }
    const range = lineRange(bm.line);
    at.ed.selection = new vscode.Selection(range.start, range.start);
    at.ed.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  };
  reg('next', step(1));
  reg('previous', step(-1));

  reg('edit', async (n?: Node) => {
    const b = bmFrom(n);
    if (!b) {
      return;
    }
    const note = await promptNote('Edit bookmark note', b.note, () => tagCounts(store.all()));
    if (note !== undefined) {
      await store.update((l) => l.map((x) => (x.id === b.id ? { ...x, note: note.trim() } : x)));
    }
  });

  reg('remove', async (n?: Node) => {
    const b = bmFrom(n);
    if (b) {
      await store.update((l) => l.filter((x) => x.id !== b.id));
    }
  });

  reg('filter', () => {
    const tags = tagCounts(store.all()).map(([t]) => t);
    const box = vscode.window.createInputBox();
    box.title = 'Filter bookmarks';
    box.prompt = '#tag (prefix match) and/or text — results update as you type';
    box.placeholder = tags
      .slice(0, 6)
      .map((t) => `#${t}`)
      .join(' ');
    box.value = store.getFilter();
    box.onDidChangeValue((v) => store.setFilter(v));
    box.onDidAccept(() => box.hide());
    box.onDidHide(() => box.dispose());
    box.show();
  });

  reg('removeMissing', async () => {
    await store.update((l) => l.filter((b) => !store.isMissing(b.file)));
  });

  reg('clearFilter', () => store.setFilter(''));

  reg('search', () => {
    type Item = vscode.QuickPickItem & { bm?: Bookmark };
    const pick = vscode.window.createQuickPick<Item>();
    pick.items = groupByTag(store.all()).flatMap(([tag, items]): Item[] => [
      {
        label: tag === UNTAGGED ? tag : `# ${tag}`,
        kind: vscode.QuickPickItemKind.Separator,
      },
      ...items.map((bm) => {
        const { label, description } = rowText(bm);
        return { bm, label: `$(bookmark) ${label}`, description };
      }),
    ]);
    pick.matchOnDescription = true;
    pick.placeholder = 'Search bookmarks — type #tag or text';
    pick.onDidAccept(async () => {
      const bm = pick.selectedItems[0]?.bm;
      pick.hide();
      if (bm) {
        await reveal(bm);
      }
    });
    pick.onDidHide(() => pick.dispose());
    pick.show();
  });

  ctx.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      const key = toKey(e.document.uri);
      const changes = e.contentChanges.map((c) => ({
        startLine: c.range.start.line,
        startChar: c.range.start.character,
        endLine: c.range.end.line,
        addedLines: c.text.split('\n').length - 1,
      }));
      void store.update((l) => shiftBookmarks(l, key, changes));
    }),
  );

  ctx.subscriptions.push(
    vscode.workspace.onDidRenameFiles((e) =>
      store.update((l) => e.files.reduce((acc, f) => renameKeys(acc, toKey(f.oldUri), toKey(f.newUri)), l)),
    ),
    vscode.workspace.onDidDeleteFiles(() => store.refreshMissing()),
    vscode.workspace.onDidCreateFiles(() => store.refreshMissing()),
    vscode.window.onDidChangeWindowState((s) => {
      if (s.focused) {
        void store.refreshMissing();
      }
    }),
  );

  let fileWatch: vscode.Disposable | undefined;
  const applyStorage = async () => {
    fileWatch?.dispose();
    fileWatch = undefined;
    const folder = vscode.workspace.workspaceFolders?.[0];
    const wantFile = vscode.workspace.getConfiguration('bookmark').get<boolean>('saveToFile', false);
    if (!wantFile || !folder) {
      store.setBackend(memento);
      await store.save(store.all());
      return;
    }
    const file = new FileStorage(vscode.Uri.joinPath(folder.uri, '.vscode', 'bookmarks.json'));
    const warn = (err: unknown) =>
      void vscode.window.showWarningMessage(
        `Bookmark: .vscode/bookmarks.json is invalid (${err}). Keeping current bookmarks.`,
      );
    try {
      const existing = await file.read();
      if (existing) {
        store.replace(existing);
      } else {
        await file.write(store.all());
      }
    } catch (err) {
      warn(err);
      store.setBackend(memento);
      return;
    }
    store.setBackend(file);
    fileWatch = file.watch((list) => store.replace(list), warn);
  };
  await applyStorage();
  ctx.subscriptions.push(
    { dispose: () => fileWatch?.dispose() },
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('bookmark.saveToFile')) {
        void applyStorage();
      }
    }),
  );

  store
    .update((l) => {
      const migrated = l.map((b) => ({ ...b, file: toKey(toUri(b.file)) }));
      return migrated.some((b, i) => b.file !== l[i]?.file) ? migrated : l;
    })
    .catch((err) => console.error('Bookmark: migrating stored paths failed', err));
  void store.refreshMissing();

  registerGutter(ctx, store);
  ctx.subscriptions.push(view);
  return { store, tree };
}

export function deactivate() {}
