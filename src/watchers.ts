import * as vscode from 'vscode';
import { renameKeys, shiftBookmarks } from './model';
import { toKey } from './paths';
import { applyChanges } from './scope';
import type { Persistence } from './storage';
import type { Store } from './store';

export function watchWorkspace(ctx: vscode.ExtensionContext, store: Store) {
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
  void store.refreshMissing();
}

export async function keepStorageInSync(ctx: vscode.ExtensionContext, store: Store, persistence: Persistence) {
  let queue: Promise<unknown> = Promise.resolve();
  const resync = () =>
    (queue = queue
      .then(async () => {
        const changes = await persistence.sync();
        await store.save(applyChanges(store.all(), changes));
      })
      .catch((err) => console.error('Hashmark: updating where bookmarks are saved failed', err)));

  ctx.subscriptions.push(
    persistence,
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('hashmark.saveToFile')) {
        void resync();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void resync()),
  );
  await resync();
}
