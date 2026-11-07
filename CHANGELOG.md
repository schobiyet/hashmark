# Changelog

All notable changes to this extension are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.2.0]

### Added

- With several workspace folders open, the sidebar groups bookmarks by folder first, then by tag.
- Every workspace folder can save its own `.vscode/bookmarks.json`.

### Changed

- `hashmark.saveToFile` can be set per workspace folder, and it now saves only that folder's bookmarks. Before, one file in the first folder held everything.
- Bookmarks of a folder that leaves the workspace come back when the folder is added again.
- A `bookmarks.json` written by 0.1.0 while several folders were open used paths that start with the folder name. Those paths are not read correctly any more. Single-folder files are unaffected.

## [0.1.0]

### Added

- Toggle or add a bookmark on any line, with a note and `#tags`, and a gutter icon.
- Tag autocomplete in the note box.
- Sidebar view grouped by tag, with live filter and a search list grouped by tag.
- Next and previous bookmark commands with keybindings.
- Bookmarks follow edits, file and folder renames, and are flagged when their file is missing.
- Optional `hashmark.saveToFile` setting to keep bookmarks in `.vscode/bookmarks.json`.
