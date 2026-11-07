import * as vscode from 'vscode';
import { lineRange, toKey } from './paths';
import type { Store } from './store';

export function registerGutter(ctx: vscode.ExtensionContext, store: Store) {
  const type = vscode.window.createTextEditorDecorationType({
    gutterIconPath: vscode.Uri.joinPath(ctx.extensionUri, 'resources', 'bookmark-gutter.svg'),
    gutterIconSize: 'contain',
  });
  const paint = (ed: vscode.TextEditor) => {
    const key = toKey(ed.document.uri);
    ed.setDecorations(
      type,
      store
        .all()
        .filter((b) => b.file === key)
        .map((b) => lineRange(b.line)),
    );
  };
  const paintAll = () => vscode.window.visibleTextEditors.forEach(paint);

  ctx.subscriptions.push(type, store.onChange(paintAll), vscode.window.onDidChangeVisibleTextEditors(paintAll));
  paintAll();
}
