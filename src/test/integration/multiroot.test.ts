import * as assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import * as vscode from 'vscode';
import type { Api } from '../../extension';
import { migrateKey } from '../../paths';
import { must, until } from './helpers';

const EXT_ID = 'schobiyet.hashmark';
const NAMES = ['a', 'b', 'c'];

describe('Hashmark multi-root workspace', () => {
  let api: Api;

  const folder = (name: string) =>
    must(
      vscode.workspace.workspaceFolders?.find((f) => f.name === name),
      `folder ${name}`,
    );
  const folderNames = () => (vscode.workspace.workspaceFolders ?? []).map((f) => f.name).join();
  const mark = (name: string, line: number, note: string) => ({
    id: `${name}-${line}`,
    file: vscode.Uri.joinPath(folder(name).uri, `${name}.txt`).toString(),
    line,
    note,
  });
  const bookmarksJson = (name: string) => vscode.Uri.joinPath(folder(name).uri, '.vscode', 'bookmarks.json');
  const exists = (uri: vscode.Uri) =>
    vscode.workspace.fs.stat(uri).then(
      () => true,
      () => false,
    );
  const read = async (name: string) =>
    JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(bookmarksJson(name))));
  const writeJson = async (name: string, text: string) => {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder(name).uri, '.vscode'));
    await vscode.workspace.fs.writeFile(bookmarksJson(name), new TextEncoder().encode(text));
  };
  const changeFolders = (start: number, remove: number, ...add: { uri: vscode.Uri; name: string }[]) =>
    until(() => vscode.workspace.updateWorkspaceFolders(start, remove, ...add), 'VS Code to accept a folder change');
  const notes = () => api.store.all().map((b) => b.note);
  const saveToFile = (on: boolean | undefined, name?: string) =>
    vscode.workspace
      .getConfiguration('hashmark', name ? folder(name).uri : undefined)
      .update('saveToFile', on, name ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global);

  const realWarn = vscode.window.showWarningMessage;
  let warned: string[] = [];

  before(async () => {
    api = await must(vscode.extensions.getExtension<Api>(EXT_ID)).activate();
  });

  beforeEach(async () => {
    warned = [];
    vscode.window.showWarningMessage = (async (m: string) => {
      warned.push(m);
    }) as never;
    await api.store.save([]);
  });

  afterEach(async () => {
    vscode.window.showWarningMessage = realWarn;
    for (const n of NAMES) {
      await saveToFile(undefined, n).then(undefined, () => {});
    }
    await saveToFile(undefined);
    await new Promise((r) => setTimeout(r, 300));
    for (const n of NAMES) {
      await vscode.workspace.fs
        .delete(vscode.Uri.joinPath(folder(n).uri, '.vscode'), {
          recursive: true,
        })
        .then(undefined, () => {});
    }
  });

  it('version 0.1.0 keys start with the folder name when several folders are open', () => {
    assert.equal(migrateKey('b/b.txt'), vscode.Uri.joinPath(folder('b').uri, 'b.txt').toString());
    assert.equal(migrateKey('c/sub/x.txt'), vscode.Uri.joinPath(folder('c').uri, 'sub', 'x.txt').toString());
  });

  it('opens with three folders', () => {
    assert.equal(folderNames(), 'a,b,c');
  });

  it('the sidebar groups by folder first, then by tag, with outside files last', async () => {
    await api.store.save([
      mark('c', 0, 'in c #t'),
      mark('a', 1, 'in a #t'),
      { id: 'o', file: 'file:///somewhere/else.txt', line: 0, note: 'outside' },
    ]);
    const roots = api.tree.getChildren();
    assert.deepEqual(
      roots.map((n) => (n.kind === 'folder' ? n.name : n.kind)),
      ['a', 'c', '(outside workspace)'],
    );
    const a = must(roots[0]);
    assert.deepEqual(
      api.tree.getChildren(a).map((n) => (n.kind === 'tag' ? n.tag : n.kind)),
      ['t'],
    );
  });

  it('each folder saves its own bookmarks with paths relative to that folder', async () => {
    await api.store.save([mark('a', 0, 'in a #x'), mark('b', 1, 'in b #y')]);
    await saveToFile(true);
    await until(async () => (await exists(bookmarksJson('a'))) && (await exists(bookmarksJson('b'))));
    assert.deepEqual(await read('a'), {
      version: 1,
      bookmarks: [{ file: 'a.txt', line: 0, note: 'in a #x' }],
    });
    assert.deepEqual(await read('b'), {
      version: 1,
      bookmarks: [{ file: 'b.txt', line: 1, note: 'in b #y' }],
    });
    assert.equal(await exists(bookmarksJson('c')), false, 'a folder without bookmarks gets no file');
  });

  it('the setting can be turned off for a single folder', async () => {
    await api.store.save([mark('a', 0, 'in a'), mark('b', 0, 'in b')]);
    await saveToFile(false, 'b');
    await saveToFile(true);
    await until(() => exists(bookmarksJson('a')));
    assert.equal(await exists(bookmarksJson('b')), false);
    assert.deepEqual(notes().sort(), ['in a', 'in b']);
  });

  it('an invalid file only blocks its own folder and is never overwritten', async () => {
    await api.store.save([mark('a', 0, 'in a'), mark('b', 0, 'in b')]);
    await writeJson('b', '{ not json');
    await saveToFile(true);
    await until(() => exists(bookmarksJson('a')));
    await until(() => warned.length > 0);
    assert.match(must(warned[0]), /b\/\.vscode\/bookmarks\.json is invalid/);
    await api.store.save([...api.store.all(), mark('b', 1, 'also in b')]);
    assert.equal(new TextDecoder().decode(await vscode.workspace.fs.readFile(bookmarksJson('b'))), '{ not json');
    assert.deepEqual(notes().sort(), ['also in b', 'in a', 'in b']);
  });

  it('an outside edit of one folder’s file only changes that folder', async () => {
    await api.store.save([mark('a', 0, 'in a'), mark('b', 0, 'in b')]);
    await saveToFile(true);
    await until(async () => (await exists(bookmarksJson('a'))) && (await exists(bookmarksJson('b'))));
    await writeJson(
      'b',
      JSON.stringify({
        version: 1,
        bookmarks: [{ file: 'b.txt', line: 2, note: 'edited outside' }],
      }),
    );
    await until(() => notes().includes('edited outside'));
    assert.deepEqual(notes().sort(), ['edited outside', 'in a']);
  });

  it('bookmarks come back when a removed folder is added again', async () => {
    await saveToFile(false, 'a');
    await saveToFile(true);
    await api.store.save([mark('a', 0, 'in a'), mark('c', 0, 'in c')]);
    await until(() => exists(bookmarksJson('c')), 'c to save its file');

    const c = folder('c');
    await changeFolders(2, 1);
    await until(() => folderNames() === 'a,b', 'folders a,b after removing c');
    await until(() => !notes().includes('in c'), 'c bookmarks to leave while c is away');
    assert.ok(notes().includes('in a'));
    await changeFolders(2, 0, { uri: c.uri, name: 'c' });
    await until(() => folderNames() === 'a,b,c', 'folders a,b,c after adding c');
    await until(() => notes().includes('in c'), 'c bookmarks to return');

    const a = folder('a');
    await changeFolders(0, 1);
    await until(() => folderNames() === 'b,c', 'folders b,c after removing a');
    assert.ok(notes().includes('in a'), 'bookmarks in VS Code storage stay while the folder is away');
    await changeFolders(2, 0, { uri: a.uri, name: 'a' });
    await until(() => folderNames() === 'b,c,a', 'folders b,c,a after adding a');
    assert.deepEqual(notes().sort(), ['in a', 'in c']);
  });
});
