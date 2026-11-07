import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { Bookmark } from '../model';
import { applyChanges, groupByFolder, isUnder, replaceUnder, splitBy } from '../scope';

const bm = (id: string, file: string, line = 0): Bookmark => ({
  id,
  file,
  line,
  note: '',
});
const A = 'file:///w/a';
const B = 'file:///w/b';

describe('isUnder', () => {
  it('matches the folder itself and files below it', () => {
    assert.equal(isUnder(A, A), true);
    assert.equal(isUnder(A, `${A}/src/x.ts`), true);
  });
  it('does not match a sibling that only shares a prefix', () => {
    assert.equal(isUnder(A, 'file:///w/ab/x.ts'), false);
    assert.equal(isUnder(A, `${B}/x.ts`), false);
  });
  it('accepts a folder written with a trailing slash', () => {
    assert.equal(isUnder(`${A}/`, `${A}/x.ts`), true);
  });
});

describe('replaceUnder', () => {
  const list = [bm('1', `${A}/x.ts`), bm('2', `${B}/y.ts`)];
  it('swaps one folder’s bookmarks and keeps the others', () => {
    const out = replaceUnder(list, A, [bm('3', `${A}/z.ts`)]);
    assert.deepEqual(out.map((b) => b.id).sort(), ['2', '3']);
  });
  it('removes the folder’s bookmarks when nothing comes in', () => {
    assert.deepEqual(
      replaceUnder(list, A, []).map((b) => b.id),
      ['2'],
    );
  });
  it('drops an incoming bookmark that collides with a kept one', () => {
    const out = replaceUnder(list, A, [bm('3', `${B}/y.ts`)]);
    assert.deepEqual(
      out.map((b) => b.id),
      ['2'],
    );
  });
});

describe('splitBy', () => {
  it('groups by owner and puts unowned bookmarks under undefined', () => {
    const list = [bm('1', `${A}/x.ts`), bm('2', `${B}/y.ts`), bm('3', 'file:///elsewhere/z.ts'), bm('4', `${A}/w.ts`)];
    const groups = splitBy(list, (file) => [A, B].find((f) => isUnder(f, file)));
    assert.deepEqual(
      groups.get(A)?.map((b) => b.id),
      ['1', '4'],
    );
    assert.deepEqual(
      groups.get(B)?.map((b) => b.id),
      ['2'],
    );
    assert.deepEqual(
      groups.get(undefined)?.map((b) => b.id),
      ['3'],
    );
  });
});

describe('groupByFolder', () => {
  const list = [bm('1', `${B}/y.ts`), bm('2', 'file:///elsewhere/z.ts'), bm('3', `${A}/x.ts`)];
  it('follows the folder order, puts outside bookmarks last and skips empty folders', () => {
    const out = groupByFolder(list, [A, B, 'file:///w/empty']);
    assert.deepEqual(
      out.map(([folder, items]) => [folder, items.map((b) => b.id)]),
      [
        [A, ['3']],
        [B, ['1']],
        [undefined, ['2']],
      ],
    );
  });
  it('is empty for no bookmarks', () => {
    assert.deepEqual(groupByFolder([], [A, B]), []);
  });
});

describe('applyChanges', () => {
  const list = [bm('1', `${A}/x.ts`), bm('2', `${B}/y.ts`)];
  it('replaces a folder with its file’s bookmarks and drops a folder that left', () => {
    const out = applyChanges(list, [
      { folder: A, bookmarks: [bm('3', `${A}/z.ts`)] },
      { folder: B, bookmarks: undefined },
    ]);
    assert.deepEqual(
      out.map((b) => b.id),
      ['3'],
    );
  });
  it('changes nothing for no changes', () => {
    assert.deepEqual(applyChanges(list, []), list);
  });
});
