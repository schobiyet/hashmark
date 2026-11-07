import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  applyTag,
  type Bookmark,
  filterBookmarks,
  groupByTag,
  neighbor,
  renameKeys,
  shiftBookmarks,
  tagCounts,
  tagSuggestions,
  tagsOf,
  toggle,
  UNTAGGED,
  upsert,
} from '../model';
import { parse, serialize } from '../serialize';

const bm = (id: string, note: string, file = 'file:///a.ts', line = 0): Bookmark => ({ id, file, line, note });

describe('tagsOf', () => {
  it('extracts lowercase unique tags', () => {
    assert.deepEqual(tagsOf('fix #Todo later #bug #todo'), ['todo', 'bug']);
  });
  it('allows dashes and underscores', () => {
    assert.deepEqual(tagsOf('#a-b #c_d'), ['a-b', 'c_d']);
  });
  it('returns empty when no tags', () => {
    assert.deepEqual(tagsOf('no tags here, issue 5'), []);
    assert.deepEqual(tagsOf('#'), []);
  });
});

describe('filterBookmarks', () => {
  const list = [bm('1', 'login #bug #auth'), bm('2', 'cleanup #todo'), bm('3', 'plain note', 'file:///b.ts')];

  it('empty or whitespace filter returns all', () => {
    assert.equal(filterBookmarks(list, ''), list);
    assert.equal(filterBookmarks(list, '   '), list);
  });
  it('matches tag by prefix, case-insensitive', () => {
    assert.deepEqual(
      filterBookmarks(list, '#BU').map((b) => b.id),
      ['1'],
    );
  });
  it('requires every tag', () => {
    assert.deepEqual(
      filterBookmarks(list, '#bug #auth').map((b) => b.id),
      ['1'],
    );
    assert.deepEqual(filterBookmarks(list, '#bug #todo'), []);
  });
  it('matches plain text in note or file', () => {
    assert.deepEqual(
      filterBookmarks(list, 'plain').map((b) => b.id),
      ['3'],
    );
    assert.deepEqual(
      filterBookmarks(list, 'b.ts').map((b) => b.id),
      ['3'],
    );
  });
  it('combines tag and text', () => {
    assert.deepEqual(
      filterBookmarks(list, '#bug login').map((b) => b.id),
      ['1'],
    );
    assert.deepEqual(filterBookmarks(list, '#bug cleanup'), []);
  });
});

describe('groupByTag', () => {
  it('puts multi-tag bookmark in each group, sorted, with untagged group', () => {
    const groups = groupByTag([bm('1', '#b #a'), bm('2', '#a'), bm('3', 'none')]);
    assert.deepEqual(
      groups.map(([t, items]) => [t, items.map((i) => i.id)]),
      [
        [UNTAGGED, ['3']],
        ['a', ['1', '2']],
        ['b', ['1']],
      ],
    );
  });
  it('is empty for empty input', () => {
    assert.deepEqual(groupByTag([]), []);
  });
});

describe('upsert', () => {
  it('appends a new bookmark with trimmed note', () => {
    assert.deepEqual(
      upsert([], 'u', 3, '  hi #x ').map(({ id, ...rest }) => ({ ...rest })),
      [{ file: 'u', line: 3, note: 'hi #x' }],
    );
  });
  it('replaces same file+line and keeps id', () => {
    const out = upsert([bm('old', 'a', 'u', 3), bm('o2', 'b', 'u', 4)], 'u', 3, 'new');
    assert.deepEqual(
      out.map((b) => [b.id, b.note]),
      [
        ['o2', 'b'],
        ['old', 'new'],
      ],
    );
  });
  it('does not mutate input', () => {
    const input = [bm('1', 'a', 'u', 1)];
    upsert(input, 'u', 1, 'z');
    assert.equal(input[0]?.note, 'a');
  });
});

describe('toggle', () => {
  it('adds an empty-note bookmark when none exists', () => {
    assert.deepEqual(
      toggle([], 'u', 2).map(({ id, ...rest }) => ({ ...rest })),
      [{ file: 'u', line: 2, note: '' }],
    );
    assert.notEqual(toggle([], 'u', 2)[0]?.id, toggle([], 'u', 2)[0]?.id); // fresh id each time
  });
  it('removes only the bookmark at that file+line', () => {
    const out = toggle([bm('1', 'a', 'u', 2), bm('2', 'b', 'u', 3), bm('3', 'c', 'v', 2)], 'u', 2);
    assert.deepEqual(
      out.map((b) => b.id),
      ['2', '3'],
    );
  });
});

describe('shiftBookmarks', () => {
  const at = (id: string, line: number, file = 'u') => bm(id, '', file, line);
  const ch = (startLine: number, endLine: number, addedLines: number, startChar = 5) => ({
    startLine,
    startChar,
    endLine,
    addedLines,
  });
  const lines = (l: Bookmark[]) => l.map((b) => [b.id, b.line]);

  it('shifts bookmarks below an insertion down', () => {
    assert.deepEqual(lines(shiftBookmarks([at('a', 2), at('b', 5)], 'u', [ch(3, 3, 2)])), [
      ['a', 2],
      ['b', 7],
    ]);
  });
  it('shifts bookmarks below a deletion up', () => {
    assert.deepEqual(lines(shiftBookmarks([at('a', 2), at('b', 9)], 'u', [ch(3, 6, 0)])), [
      ['a', 2],
      ['b', 6],
    ]);
  });
  it('keeps a bookmark when typing mid-line, even with a newline after it', () => {
    assert.deepEqual(lines(shiftBookmarks([at('a', 3)], 'u', [ch(3, 3, 1)])), [['a', 3]]);
  });
  it('moves a bookmark down when Enter is pressed at column 0 of its line', () => {
    assert.deepEqual(lines(shiftBookmarks([at('a', 3)], 'u', [ch(3, 3, 1, 0)])), [['a', 4]]);
  });
  it('drops bookmarks on deleted lines but keeps the start line', () => {
    const out = shiftBookmarks([at('s', 3), at('x', 4), at('y', 6), at('z', 7)], 'u', [ch(3, 6, 0)]);
    assert.deepEqual(lines(out), [
      ['s', 3],
      ['z', 4],
    ]);
  });
  it('keeps bookmarks inside a replaced block that still has those lines', () => {
    assert.deepEqual(lines(shiftBookmarks([at('a', 4)], 'u', [ch(3, 5, 2)])), [['a', 4]]);
  });
  it('ignores other files and same-line-count edits, returning the same array', () => {
    const list = [at('a', 2, 'other'), at('b', 8)];
    assert.equal(shiftBookmarks(list, 'u', [ch(1, 1, 0)]), list);
    assert.deepEqual(lines(shiftBookmarks(list, 'u', [ch(0, 0, 1)])), [
      ['a', 2],
      ['b', 9],
    ]);
  });
  it('applies descending multi-cursor changes sequentially', () => {
    assert.deepEqual(lines(shiftBookmarks([at('a', 10)], 'u', [ch(8, 8, 1), ch(2, 2, 1)])), [['a', 12]]);
  });
  it('drops duplicates created by a collision', () => {
    assert.deepEqual(lines(shiftBookmarks([at('a', 3), at('b', 5)], 'u', [ch(3, 5, 0)])), [['a', 3]]);
  });
});

describe('renameKeys', () => {
  const list = [bm('1', '', 'src/a.ts'), bm('2', '', 'src/dir/b.ts'), bm('3', '', 'src/dir2/c.ts')];

  it('renames an exact file', () => {
    assert.deepEqual(
      renameKeys(list, 'src/a.ts', 'src/z.ts').map((b) => b.file),
      ['src/z.ts', 'src/dir/b.ts', 'src/dir2/c.ts'],
    );
  });
  it('renames everything under a folder but not look-alike siblings', () => {
    assert.deepEqual(
      renameKeys(list, 'src/dir', 'lib/dir').map((b) => b.file),
      ['src/a.ts', 'lib/dir/b.ts', 'src/dir2/c.ts'],
    );
  });
  it('returns the same array when nothing matches', () => {
    assert.equal(renameKeys(list, 'nope', 'x'), list);
  });
});

describe('neighbor', () => {
  const list = [bm('c', '', 'u', 9), bm('a', '', 'u', 2), bm('b', '', 'u', 5), bm('x', '', 'other', 4)];

  it('finds the next bookmark below, regardless of list order', () => {
    assert.equal(neighbor(list, 'u', 2, 1)?.id, 'b');
    assert.equal(neighbor(list, 'u', 3, 1)?.id, 'b');
  });
  it('finds the previous bookmark above', () => {
    assert.equal(neighbor(list, 'u', 9, -1)?.id, 'b');
    assert.equal(neighbor(list, 'u', 6, -1)?.id, 'b');
  });
  it('wraps around at both ends', () => {
    assert.equal(neighbor(list, 'u', 9, 1)?.id, 'a');
    assert.equal(neighbor(list, 'u', 2, -1)?.id, 'c');
  });
  it('ignores other files and returns undefined when the file has none', () => {
    assert.equal(neighbor(list, 'nope', 0, 1), undefined);
    assert.equal(neighbor(list, 'other', 4, 1)?.id, 'x'); // only one: wraps to itself
  });
});

describe('serialize / parse', () => {
  it('round-trips file, line and note, sorted by file then line, without ids', () => {
    const text = serialize([bm('1', 'b', 'z.ts', 5), bm('2', 'a', 'a.ts', 9), bm('3', 'c', 'a.ts', 1)]);
    assert.deepEqual(
      JSON.parse(text).bookmarks.map((b: { file: string; line: number }) => [b.file, b.line]),
      [
        ['a.ts', 1],
        ['a.ts', 9],
        ['z.ts', 5],
      ],
    );
    assert.ok(!text.includes('"id"'));
    assert.ok(text.endsWith('}\n'));
    assert.deepEqual(
      parse(text).map(({ file, line, note }) => ({ file, line, note })),
      [
        { file: 'a.ts', line: 1, note: 'c' },
        { file: 'a.ts', line: 9, note: 'a' },
        { file: 'z.ts', line: 5, note: 'b' },
      ],
    );
  });
  it('gives each parsed bookmark a distinct id', () => {
    const ids = parse(serialize([bm('1', '', 'a', 1), bm('2', '', 'a', 2)])).map((b) => b.id);
    assert.equal(new Set(ids).size, 2);
  });
  it('drops duplicate file+line entries, keeping the first', () => {
    const text = JSON.stringify({
      version: 1,
      bookmarks: [
        { file: 'a', line: 1, note: 'x' },
        { file: 'a', line: 1, note: 'y' },
      ],
    });
    assert.deepEqual(
      parse(text).map((b) => b.note),
      ['x'],
    );
  });
  it('rejects bad json, wrong version and invalid entries', () => {
    assert.throws(() => parse('{ nope'));
    assert.throws(() => parse('{"version":2,"bookmarks":[]}'), /version 1/);
    assert.throws(() => parse('{"version":1}'), /version 1/);
    assert.throws(() => parse('{"version":1,"bookmarks":[{"file":"a","line":-1,"note":""}]}'), /invalid bookmark/);
    assert.throws(() => parse('{"version":1,"bookmarks":[{"file":"a","line":1.5,"note":""}]}'), /invalid bookmark/);
    assert.throws(() => parse('{"version":1,"bookmarks":[{"line":1,"note":""}]}'), /invalid bookmark/);
  });
});

describe('tag autocomplete', () => {
  const counts = tagCounts([bm('1', '#bug #todo'), bm('2', '#todo'), bm('3', '#test'), bm('4', 'x #Todo')]);

  it('counts tags, most used first, ties alphabetical', () => {
    assert.deepEqual(counts, [
      ['todo', 3],
      ['bug', 1],
      ['test', 1],
    ]);
  });
  it('suggests tags completing the trailing fragment, case-insensitive', () => {
    assert.deepEqual(
      tagSuggestions('fix #t', counts).map(([t]) => t),
      ['todo', 'test'],
    );
    assert.deepEqual(
      tagSuggestions('fix #T', counts).map(([t]) => t),
      ['todo', 'test'],
    );
  });
  it('suggests every tag for a bare #', () => {
    assert.equal(tagSuggestions('#', counts).length, 3);
  });
  it('suggests nothing without a trailing fragment', () => {
    assert.deepEqual(tagSuggestions('fix #todo ', counts), []);
    assert.deepEqual(tagSuggestions('plain', counts), []);
    assert.deepEqual(tagSuggestions('', counts), []);
  });
  it('skips the exact tag already typed and tags the note already has', () => {
    assert.deepEqual(
      tagSuggestions('#todo #t', counts).map(([t]) => t),
      ['test'],
    );
    assert.deepEqual(tagSuggestions('x #bug', counts), []);
  });
  it('completes the fragment with the tag and a space, leaving the rest alone', () => {
    assert.equal(applyTag('fix #bu', 'bug'), 'fix #bug ');
    assert.equal(applyTag('#a #te', 'test'), '#a #test ');
  });
});
