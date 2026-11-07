import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

export function must<T>(value: T | undefined | null, what = 'value'): T {
  assert.ok(value !== undefined && value !== null, `expected ${what} to exist`);
  return value;
}

export async function until(cond: () => boolean | PromiseLike<boolean>, what = 'condition', ms = 4000) {
  for (let t = 0; t < ms; t += 50) {
    if (await cond()) {
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`timed out waiting for ${what}`);
}

export async function moveCursor(doc: vscode.TextDocument, line: number) {
  const ed = await vscode.window.showTextDocument(doc);
  ed.selection = new vscode.Selection(line, 0, line, 0);
  return ed;
}

export type Item = vscode.QuickPickItem & { tag?: string; bm?: unknown };

export class FakePick {
  static last?: FakePick;
  value = '';
  title = '';
  placeholder = '';
  items: Item[] = [];
  activeItems: Item[] = [];
  selectedItems: Item[] = [];
  private onChange = () => {};
  private onAccept = () => {};
  private onHide = () => {};

  constructor(private script: (p: FakePick) => void) {
    FakePick.last = this;
  }

  onDidChangeValue(fn: () => void) {
    this.onChange = fn;
  }
  onDidAccept(fn: () => void) {
    this.onAccept = fn;
  }
  onDidHide(fn: () => void) {
    this.onHide = fn;
  }
  show() {
    setTimeout(() => this.script(this), 0);
  }
  hide() {
    this.onHide();
  }
  dispose() {}

  type(value: string) {
    this.value = value;
    this.onChange();
  }
  accept(selected: Item[] = []) {
    this.selectedItems = selected;
    this.onAccept();
  }
}

const realCreateQuickPick = vscode.window.createQuickPick;
export const useQuickPick = (script: (p: FakePick) => void = () => {}) => {
  vscode.window.createQuickPick = (() => new FakePick(script)) as never;
};
export const restoreQuickPick = () => {
  vscode.window.createQuickPick = realCreateQuickPick;
};
export const lastPick = () => must(FakePick.last, 'a quick pick');
