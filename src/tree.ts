import * as vscode from 'vscode';
import { type Bookmark, groupByTag, UNTAGGED } from './model';
import { lineRange, rowText, toUri } from './paths';
import { groupByFolder } from './scope';
import type { Store } from './store';

export type Node =
  | { kind: 'folder'; name: string; items: Bookmark[] }
  | { kind: 'tag'; tag: string; items: Bookmark[] }
  | { kind: 'bm'; bm: Bookmark };

const OUTSIDE = '(outside workspace)';

export class Tree implements vscode.TreeDataProvider<Node> {
  readonly onDidChangeTreeData: vscode.Event<void>;

  constructor(private store: Store) {
    this.onDidChangeTreeData = store.onChange;
  }

  getTreeItem(n: Node): vscode.TreeItem {
    if (n.kind === 'folder') {
      const item = new vscode.TreeItem(n.name, vscode.TreeItemCollapsibleState.Expanded);
      item.description = String(n.items.length);
      item.iconPath = new vscode.ThemeIcon('folder');
      return item;
    }
    if (n.kind === 'tag') {
      const item = new vscode.TreeItem(
        n.tag === UNTAGGED ? n.tag : `# ${n.tag}`,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.description = String(n.items.length);
      return item;
    }
    const { bm } = n;
    const uri = toUri(bm.file);
    const { label, description } = rowText(bm);
    const missing = this.store.isMissing(bm.file);
    const item = new vscode.TreeItem(label);
    item.description = missing ? `${description} (file missing)` : description;
    item.tooltip = `${uri.fsPath}:${bm.line + 1}`;
    item.iconPath = new vscode.ThemeIcon(missing ? 'warning' : 'bookmark');
    item.contextValue = 'bookmark';
    item.command = {
      command: 'vscode.open',
      title: 'Open',
      arguments: [uri, { selection: lineRange(bm.line) }],
    };
    return item;
  }

  getChildren(n?: Node): Node[] {
    if (n?.kind === 'bm') {
      return [];
    }
    if (n?.kind === 'tag') {
      return n.items.map((bm) => ({ kind: 'bm', bm }));
    }
    if (n?.kind === 'folder') {
      return tagNodes(n.items);
    }
    const folders = vscode.workspace.workspaceFolders ?? [];
    const filtered = this.store.filtered();
    if (folders.length < 2) {
      return tagNodes(filtered);
    }
    const names = new Map(folders.map((f) => [f.uri.toString(), f.name]));
    return groupByFolder(
      filtered,
      folders.map((f) => f.uri.toString()),
    ).map(([folder, items]) => ({
      kind: 'folder',
      name: (folder && names.get(folder)) || OUTSIDE,
      items,
    }));
  }
}

const tagNodes = (items: Bookmark[]): Node[] =>
  groupByTag(items).map(([tag, group]) => ({ kind: 'tag', tag, items: group }));
