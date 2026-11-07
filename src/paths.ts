import * as vscode from 'vscode';
import type { Bookmark } from './model';

export const toKey = (uri: vscode.Uri): string => uri.toString();
export const toUri = (key: string): vscode.Uri => vscode.Uri.parse(key);

export function migrateKey(key: string): string {
  if (/^[a-z][a-z0-9+.-]+:/i.test(key)) {
    return key;
  }
  const folders = vscode.workspace.workspaceFolders ?? [];
  const parts = key.split('/');
  const named = folders.length > 1 ? folders.find((f) => f.name === parts[0]) : undefined;
  const folder = named ?? folders[0];
  return folder ? vscode.Uri.joinPath(folder.uri, ...(named ? parts.slice(1) : parts)).toString() : key;
}

export const toRelative = (folder: vscode.Uri, key: string): string =>
  toUri(key).path.slice(folder.path.length).replace(/^\//, '');

export const fromRelative = (folder: vscode.Uri, relative: string): string =>
  vscode.Uri.joinPath(folder, ...relative.split('/')).toString();

export const displayPath = (key: string): string => vscode.workspace.asRelativePath(toUri(key));

export const lineRange = (line: number) => new vscode.Range(line, 0, line, 0);

export const rowText = (b: Bookmark) => ({
  label: b.note || `line ${b.line + 1}`,
  description: `${displayPath(b.file)}:${b.line + 1}`,
});
