import * as vscode from 'vscode';
import { type Bookmark, groupByTag, isAt, neighbor, tagCounts, toggle, UNTAGGED, upsert } from './model';
import { promptNote } from './noteInput';
import { lineRange, rowText, toKey, toUri } from './paths';
import type { Store } from './store';
import type { Node } from './tree';

const bookmarkOf = (n?: Node): Bookmark | undefined => (n?.kind === 'bm' ? n.bm : undefined);

const reveal = (bm: Bookmark) =>
  vscode.window.showTextDocument(toUri(bm.file), {
    selection: lineRange(bm.line),
  });

type Here = { ed: vscode.TextEditor; key: string; line: number };

const withHere =
  <T>(fn: (at: Here) => T) =>
  () => {
    const ed = vscode.window.activeTextEditor;
    return ed ? fn({ ed, key: toKey(ed.document.uri), line: ed.selection.active.line }) : undefined;
  };

export function registerCommands(ctx: vscode.ExtensionContext, store: Store) {
  const reg = <A extends unknown[]>(id: string, fn: (...args: A) => unknown) =>
    ctx.subscriptions.push(vscode.commands.registerCommand(`hashmark.${id}`, fn));
  const askNote = (title: string, value: string) => promptNote(title, value, () => tagCounts(store.all()));

  reg(
    'add',
    withHere(async (at) => {
      const existing = store.all().find(isAt(at.key, at.line));
      const note = await askNote('Bookmark note', existing?.note ?? '');
      if (note !== undefined) {
        await store.update((l) => upsert(l, at.key, at.line, note));
      }
    }),
  );

  reg(
    'toggle',
    withHere((at) => store.update((l) => toggle(l, at.key, at.line))),
  );

  const step = (dir: 1 | -1) =>
    withHere((at) => {
      const bm = neighbor(store.all(), at.key, at.line, dir);
      if (!bm) {
        vscode.window.setStatusBarMessage('No bookmarks in this file', 2000);
        return;
      }
      const range = lineRange(bm.line);
      at.ed.selection = new vscode.Selection(range.start, range.start);
      at.ed.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    });
  reg('next', step(1));
  reg('previous', step(-1));

  reg('edit', async (n?: Node) => {
    const bm = bookmarkOf(n);
    const note = bm && (await askNote('Edit bookmark note', bm.note));
    if (bm && note !== undefined) {
      await store.update((l) => l.map((x) => (x.id === bm.id ? { ...x, note: note.trim() } : x)));
    }
  });

  reg('remove', async (n?: Node) => {
    const bm = bookmarkOf(n);
    if (bm) {
      await store.update((l) => l.filter((x) => x.id !== bm.id));
    }
  });

  reg('removeMissing', () => store.update((l) => l.filter((b) => !store.isMissing(b.file))));

  reg('clearFilter', () => store.setFilter(''));

  reg('filter', () => {
    const tags = tagCounts(store.all()).map(([t]) => `#${t}`);
    const box = vscode.window.createInputBox();
    box.title = 'Filter bookmarks';
    box.prompt = '#tag (prefix match) and/or text — results update as you type';
    box.placeholder = tags.slice(0, 6).join(' ');
    box.value = store.getFilter();
    box.onDidChangeValue((v) => store.setFilter(v));
    box.onDidAccept(() => box.hide());
    box.onDidHide(() => box.dispose());
    box.show();
  });

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
}
