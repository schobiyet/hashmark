# Bookmark

Bookmark lines of code, add a note, and tag it with `#tags`. Then browse, filter and search your bookmarks by tag.

## Features

- **Bookmark any line.** Press `Cmd+Alt+L` to toggle a bookmark on the cursor line. A bookmark icon appears in the gutter.
- **Notes and `#tags`.** Press `Cmd+Alt+K` to add a note such as `check retry logic #bug #api`. Every `#word` in the note becomes a tag.
- **Tag autocomplete.** While typing `#`, existing tags are suggested with their counts. Arrow down + Enter completes one; plain Enter saves exactly what you typed, so a brand new tag is never swapped for an old one.
- **Sidebar grouped by tag.** The Bookmarks view lists your bookmarks under `# tag` headers. A bookmark with two tags appears under both. Bookmarks without tags are under `(untagged)`. Click one to jump to its line.
- **Search.** The search button opens a list grouped by tag. Type `#tag` or text to narrow it, press Enter to jump.
- **Filter.** The filter button narrows the sidebar as you type: `#bug` (prefix match), `login`, or both: `#bug login`. Clear it with the clear button.
- **Next / previous bookmark.** Jump between the bookmarks of the current file, wrapping at the ends.
- **Bookmarks follow your edits.** Insert or delete lines above a bookmark and it moves with its code. Pressing Enter at the start of a bookmarked line moves it down with its text. Deleting a bookmarked line removes the bookmark.
- **Renames and deletes.** Renaming a file or folder in VS Code updates its bookmarks. Bookmarks whose file no longer exists get a warning icon, and one command removes them all.
- **Share with your team (optional).** Turn on `bookmark.saveToFile` to keep bookmarks in `.vscode/bookmarks.json` and commit them.

## Commands and keys

| Command | Key (macOS / other) |
| --- | --- |
| Bookmark: Toggle Bookmark | `Cmd+Alt+L` / `Ctrl+Alt+L` |
| Bookmark: Add Bookmark (with note) | `Cmd+Alt+K` / `Ctrl+Alt+K` |
| Bookmark: Next Bookmark in File | `Cmd+Alt+.` / `Ctrl+Alt+.` |
| Bookmark: Previous Bookmark in File | `Cmd+Alt+,` / `Ctrl+Alt+,` |
| Bookmark: Search Bookmarks | sidebar title button |
| Bookmark: Filter by Tag / Text | sidebar title button |
| Bookmark: Clear Filter | sidebar title button |
| Bookmark: Remove Bookmarks of Missing Files | sidebar `…` menu |

Right-click a line number to toggle or add a bookmark there. In the sidebar, hover a bookmark for the edit and remove buttons.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `bookmark.saveToFile` | `false` | Save bookmarks to `.vscode/bookmarks.json` in the first workspace folder instead of inside VS Code. Turning it on loads the file if it exists; otherwise your current bookmarks are written to it. An invalid file is never overwritten. |

## Saving and sharing

By default bookmarks are private to you and this workspace, stored inside VS Code. With `bookmark.saveToFile` on, they live in `.vscode/bookmarks.json`:

```json
{
  "version": 1,
  "bookmarks": [{ "file": "src/api.ts", "line": 41, "note": "check retry logic #bug #api" }]
}
```

The file is sorted so diffs stay small. Changes made outside VS Code, such as a `git pull`, show up without a reload. Paths are relative to the workspace folder, so the file works on every machine. `line` is 0-based.

## Known limitations

- Bookmarks follow edits made in VS Code. Changes made outside VS Code (for example `git checkout`) are not tracked line by line.
- File storage uses the first workspace folder only.
- Bookmarks of files outside the workspace folder are saved with their full path, so they will not work on another machine.

## Development

```sh
npm install
npm run compile      # build
npm test             # unit tests (node:test) + integration tests inside VS Code
npm run lint         # Biome
npm run format       # Biome, writes fixes
```

Press `F5` in VS Code to launch an Extension Development Host. Package with `npx @vscode/vsce package`.
