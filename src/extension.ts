import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { registerGutter } from './gutter';
import { replaceUnder } from './scope';
import { Persistence } from './storage';
import { Store } from './store';
import { Tree } from './tree';
import { keepStorageInSync, watchWorkspace } from './watchers';

export interface Api {
  store: Store;
  tree: Tree;
}

export async function activate(ctx: vscode.ExtensionContext): Promise<Api> {
  const warn = (message: string) => void vscode.window.showWarningMessage(message);
  const persistence = new Persistence(
    ctx.workspaceState,
    (folder, list) => store.replace(replaceUnder(store.all(), folder, list)),
    warn,
  );
  const store = new Store(persistence.readMemento(), persistence, (err) =>
    warn(`Hashmark: could not save bookmarks (${err}).`),
  );
  const tree = new Tree(store);
  const view = vscode.window.createTreeView('hashmark.view', { treeDataProvider: tree });
  const showFilter = () => {
    view.message = store.getFilter() ? `Filter: ${store.getFilter()}` : undefined;
  };
  ctx.subscriptions.push(store, view, store.onChange(showFilter));

  registerCommands(ctx, store);
  watchWorkspace(ctx, store);
  registerGutter(ctx, store);
  await keepStorageInSync(ctx, store, persistence);
  return { store, tree };
}

export function deactivate() {}
