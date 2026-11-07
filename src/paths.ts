import * as vscode from 'vscode';
import type { Bookmark } from './model';

const isFullUri = (key: string) => /^[a-z][a-z0-9+.-]+:/i.test(key);

export function toKey(uri: vscode.Uri): string {
  const folder = uri.scheme === 'file' ? vscode.workspace.getWorkspaceFolder(uri) : undefined;
  if (!folder) {
    return uri.toString();
  }
  const rel = uri.path.slice(folder.uri.path.length).replace(/^\//, '');
  return (vscode.workspace.workspaceFolders?.length ?? 0) > 1 ? `${folder.name}/${rel}` : rel;
}

export function toUri(key: string): vscode.Uri {
  if (isFullUri(key)) {
    return vscode.Uri.parse(key);
  }
  const folders = vscode.workspace.workspaceFolders ?? [];
  const parts = key.split('/');
  if (folders.length > 1) {
    const folder = folders.find((f) => f.name === parts[0]);
    if (folder) {
      return vscode.Uri.joinPath(folder.uri, ...parts.slice(1));
    }
  }
  const [first] = folders;
  return first ? vscode.Uri.joinPath(first.uri, ...parts) : vscode.Uri.file(key);
}

export const displayPath = (key: string): string =>
  isFullUri(key) ? vscode.workspace.asRelativePath(vscode.Uri.parse(key)) : key;

export const lineRange = (line: number) => new vscode.Range(line, 0, line, 0);

export const rowText = (b: Bookmark) => ({
  label: b.note || `line ${b.line + 1}`,
  description: `${displayPath(b.file)}:${b.line + 1}`,
});
