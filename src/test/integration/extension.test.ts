import * as assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import * as vscode from 'vscode';
import type { Api } from '../../extension';
import { displayPath, fromRelative, migrateKey, toKey, toRelative, toUri } from '../../paths';
import { Persistence } from '../../storage';
import { Store } from '../../store';
import type { Node } from '../../tree';
import { type FakePick, lastPick, moveCursor, must, restoreQuickPick, until, useQuickPick } from './helpers';

const EXT_ID = 'schobiyet.hashmark';
const run = (cmd: string, ...args: unknown[]) => vscode.commands.executeCommand(`hashmark.${cmd}`, ...args);

describe('Hashmark extension', () => {
  let api: Api;
  let doc: vscode.TextDocument;

  const answerWith = (...answers: (string | undefined)[]) =>
    useQuickPick((p) => {
      const a = answers.shift();
      if (a === undefined) {
        p.hide();
      } else {
        p.type(a);
        p.accept();
      }
    });
  const bookmarkAt = async (line: number, note: string) => {
    await moveCursor(doc, line);
    answerWith(note);
    await run('add');
  };
  const roots = () => api.tree.getChildren() as Extract<Node, { kind: 'tag' }>[];
  const firstLeaf = () => must(api.tree.getChildren(must(roots()[0]))[0], 'first bookmark');
  const notes = () => api.store.all().map((b) => b.note);
  const docKey = () => doc.uri.toString();
  const sibling = (name: string) => vscode.Uri.joinPath(doc.uri, '..', name).toString();
  const bookmarkIn = (line: number) => api.store.all().find((b) => b.line === line);

  before(async () => {
    api = await must(vscode.extensions.getExtension<Api>(EXT_ID)).activate();
    doc = await vscode.workspace.openTextDocument(must((await vscode.workspace.findFiles('sample.txt'))[0]));
  });

  beforeEach(async () => {
    await api.store.save([]);
    api.store.setFilter('');
  });

  after(restoreQuickPick);

  it('registers all commands', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const c of [
      'add',
      'toggle',
      'next',
      'previous',
      'edit',
      'remove',
      'search',
      'filter',
      'clearFilter',
      'removeMissing',
    ]) {
      assert.ok(all.includes(`hashmark.${c}`), c);
    }
  });

  it('starts with VS Code, so gutter icons and edit tracking work before any command runs', () => {
    const { activationEvents } = must(vscode.extensions.getExtension(EXT_ID)).packageJSON;
    assert.deepEqual(activationEvents, ['onStartupFinished']);
  });

  it('adds a bookmark and groups it under each tag', async () => {
    await bookmarkAt(1, 'check #todo #bug');
    assert.equal(api.store.all().length, 1);
    assert.deepEqual(
      roots().map((r) => r.tag),
      ['bug', 'todo'],
    );
    const item = api.tree.getTreeItem(firstLeaf());
    assert.equal(item.label, 'check #todo #bug');
    assert.match(String(item.description), /sample\.txt:2$/);
  });

  it('toggle adds then removes a bookmark on the cursor line', async () => {
    await moveCursor(doc, 1);
    await run('toggle');
    assert.deepEqual(
      api.store.all().map((b) => [b.line, b.note]),
      [[1, '']],
    );
    await run('toggle');
    assert.equal(api.store.all().length, 0);
  });

  it('shows untagged bookmarks in their own group', async () => {
    await bookmarkAt(0, 'no tags');
    assert.deepEqual(
      roots().map((r) => r.tag),
      ['(untagged)'],
    );
  });

  it('re-adding on the same line edits instead of duplicating', async () => {
    await bookmarkAt(0, 'first #a');
    await bookmarkAt(0, 'second #b');
    assert.deepEqual(notes(), ['second #b']);
  });

  it('cancelling the note box adds nothing', async () => {
    await moveCursor(doc, 0);
    answerWith(undefined);
    await run('add');
    assert.equal(api.store.all().length, 0);
  });

  it('filter box narrows the tree live and clear resets it', async () => {
    await bookmarkAt(0, 'a #alpha');
    await bookmarkAt(1, 'b #beta');
    const realCreate = vscode.window.createInputBox;
    let typed: (v: string) => void = () => {};
    vscode.window.createInputBox = () =>
      ({
        onDidChangeValue: (fn: (v: string) => void) => {
          typed = fn;
        },
        onDidAccept: () => {},
        onDidHide: () => {},
        show: () => {},
      }) as unknown as vscode.InputBox;
    try {
      await run('filter');
      typed('#alp');
      assert.deepEqual(
        roots().map((r) => r.tag),
        ['alpha'],
      );
    } finally {
      vscode.window.createInputBox = realCreate;
    }
    await run('clearFilter');
    assert.deepEqual(
      roots().map((r) => r.tag),
      ['alpha', 'beta'],
    );
  });

  it('search groups bookmarks under separators and jumps on accept', async () => {
    await bookmarkAt(0, 'a #alpha');
    await bookmarkAt(2, 'b #beta');
    useQuickPick();
    await run('search');
    const pick = lastPick();
    assert.deepEqual(
      pick.items.map((i) => i.label),
      ['# alpha', '$(bookmark) a #alpha', '# beta', '$(bookmark) b #beta'],
    );
    assert.deepEqual(
      pick.items.map((i) => i.kind === vscode.QuickPickItemKind.Separator),
      [true, false, true, false],
    );

    pick.accept([must(pick.items[3])]);
    await until(() => vscode.window.activeTextEditor?.selection.active.line === 2);
  });

  it('edits and removes via tree nodes', async () => {
    await bookmarkAt(0, 'old #x');
    answerWith('new #y');
    await run('edit', firstLeaf());
    assert.deepEqual(notes(), ['new #y']);
    await run('remove', firstLeaf());
    assert.equal(api.store.all().length, 0);
  });

  it('tree item opens the bookmarked line', async () => {
    await bookmarkAt(2, 'jump #go');
    const command = must(api.tree.getTreeItem(firstLeaf()).command);
    await vscode.commands.executeCommand(command.command, ...must(command.arguments));
    assert.equal(vscode.window.activeTextEditor?.selection.active.line, 2);
  });

  it('bookmarks follow edits above them and drop when their line is deleted', async () => {
    await bookmarkAt(2, 'follow #me');
    const insert = new vscode.WorkspaceEdit();
    insert.insert(doc.uri, new vscode.Position(0, 0), 'new top\nanother\n');
    await vscode.workspace.applyEdit(insert);
    assert.equal(bookmarkIn(4)?.note, 'follow #me');

    const del = new vscode.WorkspaceEdit();
    del.delete(doc.uri, new vscode.Range(3, 0, 5, 0));
    await vscode.workspace.applyEdit(del);
    assert.equal(api.store.all().length, 0);
    await vscode.commands.executeCommand('workbench.action.files.revert');
  });

  it('keys are full URIs; relative paths only exist below a folder', () => {
    const folder = vscode.Uri.joinPath(doc.uri, '..');
    assert.equal(toKey(doc.uri), doc.uri.toString());
    assert.equal(toUri(toKey(doc.uri)).toString(), doc.uri.toString());
    assert.equal(toKey(vscode.Uri.file('/somewhere/else.txt')), 'file:///somewhere/else.txt');
    assert.equal(toKey(vscode.Uri.parse('untitled:Untitled-1')), 'untitled:Untitled-1');
    assert.equal(toRelative(folder, docKey()), 'sample.txt');
    assert.equal(fromRelative(folder, 'sample.txt'), docKey());
    const spaced = fromRelative(folder, 'my dir/a b.txt');
    assert.equal(toRelative(folder, spaced), 'my dir/a b.txt');
    assert.equal(displayPath(docKey()), 'sample.txt');
  });

  it('flags bookmarks of missing files and removeMissing deletes only those', async () => {
    await api.store.save([
      { id: '1', file: docKey(), line: 0, note: 'ok #x' },
      { id: '2', file: sibling('gone.txt'), line: 0, note: 'lost #x' },
    ]);
    assert.equal(api.store.isMissing(sibling('gone.txt')), true);
    assert.equal(api.store.isMissing(docKey()), false);
    const items = api.tree.getChildren(must(roots()[0])).map((n) => api.tree.getTreeItem(n));
    const lost = must(items.find((i) => i.label === 'lost #x'));
    assert.match(String(lost.description), /\(file missing\)$/);
    assert.equal((lost.iconPath as vscode.ThemeIcon).id, 'warning');

    await run('removeMissing');
    assert.deepEqual(
      api.store.all().map((b) => b.file),
      [docKey()],
    );
  });

  it('follows file renames and keeps them unflagged', async () => {
    const a = vscode.Uri.joinPath(doc.uri, '..', 'tmp-a.txt');
    const b = vscode.Uri.joinPath(doc.uri, '..', 'tmp-b.txt');
    const create = new vscode.WorkspaceEdit();
    create.createFile(a, { ignoreIfExists: true });
    await vscode.workspace.applyEdit(create);
    try {
      await api.store.save([{ id: '1', file: sibling('tmp-a.txt'), line: 0, note: 'moving' }]);
      assert.equal(api.store.isMissing(sibling('tmp-a.txt')), false);

      const rename = new vscode.WorkspaceEdit();
      rename.renameFile(a, b);
      await vscode.workspace.applyEdit(rename);
      await until(() => api.store.all()[0]?.file === sibling('tmp-b.txt'));
      assert.equal(api.store.isMissing(sibling('tmp-b.txt')), false);
    } finally {
      await vscode.workspace.fs.delete(a).then(undefined, () => {});
      await vscode.workspace.fs.delete(b).then(undefined, () => {});
    }
  });

  it('next/previous move the cursor between bookmarks in this file and wrap', async () => {
    await bookmarkAt(0, 'one');
    await bookmarkAt(2, 'three');
    const ed = await moveCursor(doc, 1);
    const steps: [string, number][] = [
      ['next', 2],
      ['next', 0],
      ['previous', 2],
      ['previous', 0],
    ];
    for (const [cmd, line] of steps) {
      await run(cmd);
      assert.equal(ed.selection.active.line, line, cmd);
    }
  });

  it('next with no bookmarks in the file leaves the cursor alone', async () => {
    const ed = await moveCursor(doc, 1);
    await run('next');
    assert.equal(ed.selection.active.line, 1);
  });

  describe('tag autocomplete in the note box', () => {
    const addAndDrive = async (drive: (p: FakePick) => void) => {
      await moveCursor(doc, 2);
      useQuickPick(drive);
      await run('add');
    };
    const labels = () => lastPick().items.map((i) => i.label);

    beforeEach(async () => {
      await api.store.save([
        { id: '1', file: docKey(), line: 0, note: 'a #bug #todo' },
        { id: '2', file: docKey(), line: 1, note: 'b #todo' },
      ]);
    });

    it('lists matching tags with counts while typing a #fragment, nothing otherwise', async () => {
      await addAndDrive((p) => {
        p.type('fix #t');
        assert.deepEqual(labels(), ['#todo']);
        assert.equal(must(p.items[0]).description, '2 bookmarks');
        assert.equal(must(p.items[0]).alwaysShow, true);
        assert.deepEqual(p.activeItems, []);
        p.type('fix #todo ');
        assert.deepEqual(labels(), []);
        p.hide();
      });
    });

    it('choosing a suggestion completes the tag and keeps the box open', async () => {
      let hidden = false;
      await addAndDrive((p) => {
        p.type('fix #b');
        p.accept([must(p.items[0])]);
        assert.equal(p.value, 'fix #bug ');
        assert.deepEqual(labels(), []);
        const realHide = p.hide.bind(p);
        p.hide = () => {
          hidden = true;
          realHide();
        };
        p.accept();
      });
      assert.equal(hidden, true);
      assert.equal(bookmarkIn(2)?.note, 'fix #bug');
    });

    it('plain Enter saves a new tag as typed even when it prefixes an existing one', async () => {
      await addAndDrive((p) => {
        p.type('x #bu');
        p.accept();
      });
      assert.equal(bookmarkIn(2)?.note, 'x #bu');
    });

    it('editing a note offers the same suggestions', async () => {
      const todoGroup = must(roots().find((r) => r.tag === 'todo'));
      const node = must(api.tree.getChildren(todoGroup).find((n) => n.kind === 'bm' && n.bm.note === 'b #todo'));
      useQuickPick((p) => {
        assert.equal(p.value, 'b #todo');
        p.type('b #todo #bu');
        assert.deepEqual(labels(), ['#bug']);
        p.hide();
      });
      await run('edit', node);
    });
  });

  describe('a failing write', () => {
    it('is reported once per streak and never throws into the caller', async () => {
      let failing = true;
      const errors: unknown[] = [];
      const store = new Store(
        [],
        {
          write: async () => {
            if (failing) {
              throw new Error('disk full');
            }
          },
        },
        (err) => errors.push(err),
      );
      await store.save([{ id: '1', file: docKey(), line: 0, note: 'a' }]);
      await store.save([{ id: '2', file: docKey(), line: 1, note: 'b' }]);
      assert.equal(errors.length, 1, 'two failures in a row are reported once');
      assert.equal(store.all().length, 1, 'the list in memory still updates');

      failing = false;
      await store.save([]);
      failing = true;
      await store.save([]);
      assert.equal(errors.length, 2, 'a new failure after a success is reported again');
    });
  });

  describe('persistence', () => {
    const fakeState = (initial: Record<string, unknown> = {}) => {
      const saved = new Map(Object.entries(initial));
      return {
        keys: () => [...saved.keys()],
        get: <T>(k: string, d?: T) => (saved.has(k) ? (saved.get(k) as T) : d),
        update: async (k: string, v: unknown) => {
          saved.set(k, v);
        },
      };
    };

    it('reads the workspace-relative paths that version 0.1.0 stored', () => {
      assert.equal(migrateKey('sample.txt'), docKey());
      assert.equal(migrateKey(docKey()), docKey()); // already a URI
      assert.equal(migrateKey('untitled:Untitled-1'), 'untitled:Untitled-1');
      const old = new Persistence(
        fakeState({
          hashmark: [{ id: '1', file: 'sample.txt', line: 2, note: 'old #x' }],
        }),
        () => {},
        () => {},
      );
      assert.deepEqual(old.readMemento(), [{ id: '1', file: docKey(), line: 2, note: 'old #x' }]);
    });

    it('persists bookmarks across a store reload', async () => {
      await bookmarkAt(0, 'keep #me');
      const persistence = new Persistence(
        fakeState(),
        () => {},
        () => {},
      );
      await new Store([], persistence).save(api.store.all());
      assert.equal(new Store(persistence.readMemento(), persistence).all()[0]?.note, 'keep #me');
    });
  });

  describe('file storage (.vscode/bookmarks.json)', () => {
    const dir = () => vscode.Uri.joinPath(doc.uri, '..', '.vscode');
    const file = () => vscode.Uri.joinPath(dir(), 'bookmarks.json');
    const config = () => vscode.workspace.getConfiguration('hashmark');
    const readFile = async () => new TextDecoder().decode(await vscode.workspace.fs.readFile(file()));
    const writeFile = async (text: string) => {
      await vscode.workspace.fs.createDirectory(dir());
      await vscode.workspace.fs.writeFile(file(), new TextEncoder().encode(text));
    };
    const turnOn = () => config().update('saveToFile', true, vscode.ConfigurationTarget.Global);
    const realWarn = vscode.window.showWarningMessage;
    let warned: string[] = [];

    beforeEach(async () => {
      warned = [];
      vscode.window.showWarningMessage = (async (m: string) => {
        warned.push(m);
      }) as never;
      await vscode.workspace.fs.delete(dir(), { recursive: true }).then(undefined, () => {});
    });

    afterEach(async () => {
      vscode.window.showWarningMessage = realWarn;
      await config().update('saveToFile', undefined, vscode.ConfigurationTarget.Global);
      await vscode.workspace.fs.delete(dir(), { recursive: true }).then(undefined, () => {});
    });

    it('is off by default', () => {
      assert.equal(config().get('saveToFile'), false);
      assert.equal(config().inspect('saveToFile')?.defaultValue, false);
    });

    it('writes current bookmarks to the file when turned on, then saves changes', async () => {
      await bookmarkAt(1, 'shared #team');
      await turnOn();
      await until(async () => (await readFile().catch(() => '')).includes('shared #team'));
      assert.deepEqual(JSON.parse(await readFile()), {
        version: 1,
        bookmarks: [{ file: 'sample.txt', line: 1, note: 'shared #team' }],
      });

      await bookmarkAt(0, 'second');
      await until(async () => (await readFile()).includes('second'));
      assert.deepEqual(
        JSON.parse(await readFile()).bookmarks.map((b: { line: number }) => b.line),
        [0, 1],
      ); // sorted
    });

    it('an existing file replaces the bookmarks, and external edits are picked up live', async () => {
      await bookmarkAt(0, 'will be replaced');
      await writeFile(
        JSON.stringify({
          version: 1,
          bookmarks: [{ file: 'sample.txt', line: 2, note: 'from git #pull' }],
        }),
      );
      await turnOn();
      await until(() => notes().includes('from git #pull'));
      assert.equal(api.store.all().length, 1);

      await writeFile(
        JSON.stringify({
          version: 1,
          bookmarks: [{ file: 'sample.txt', line: 1, note: 'edited outside' }],
        }),
      );
      await until(() => notes().includes('edited outside'));
    });

    it('an invalid file is never overwritten; current bookmarks are kept and a warning shown', async () => {
      await bookmarkAt(0, 'precious');
      await writeFile('{ not json');
      await turnOn();
      await until(() => warned.length > 0);
      assert.match(must(warned[0]), /invalid/);
      await bookmarkAt(1, 'also precious');
      assert.equal(await readFile(), '{ not json');
      assert.equal(api.store.all().length, 2);
    });
  });
});
