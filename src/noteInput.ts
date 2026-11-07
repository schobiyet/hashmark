import * as vscode from 'vscode';
import { applyTag, tagSuggestions } from './model';

type TagItem = vscode.QuickPickItem & { tag: string };

export function promptNote(
  title: string,
  value: string,
  tagCounts: () => [string, number][],
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const pick = vscode.window.createQuickPick<TagItem>();
    pick.title = title;
    pick.placeholder = 'fix later #todo #bug';
    pick.value = value;

    const refresh = () => {
      pick.items = tagSuggestions(pick.value, tagCounts()).map(([tag, n]) => ({
        label: `#${tag}`,
        description: `${n} bookmark${n === 1 ? '' : 's'}`,
        alwaysShow: true,
        tag,
      }));
      pick.activeItems = [];
    };
    pick.onDidChangeValue(refresh);
    refresh();

    let accepted = false;
    pick.onDidAccept(() => {
      const chosen = pick.selectedItems[0];
      if (chosen) {
        pick.value = applyTag(pick.value, chosen.tag);
        refresh();
        return;
      }
      accepted = true;
      resolve(pick.value);
      pick.hide();
    });
    pick.onDidHide(() => {
      if (!accepted) {
        resolve(undefined);
      }
      pick.dispose();
    });
    pick.show();
  });
}
