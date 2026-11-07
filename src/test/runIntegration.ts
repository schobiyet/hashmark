import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

const root = path.resolve(__dirname, '../..');

async function session(workspace: string, testFile: string) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'hashmark-user-'));
  try {
    await runTests({
      extensionDevelopmentPath: root,
      extensionTestsPath: path.resolve(__dirname, 'integration/index'),
      extensionTestsEnv: { HASHMARK_TEST_FILE: testFile },
      launchArgs: [workspace, `--user-data-dir=${userData}`, '--disable-extensions'],
    });
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

async function main() {
  await session(path.join(root, 'src/test/fixture'), 'extension.test.js');

  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'hashmark-multi-'));
  try {
    fs.cpSync(path.join(root, 'src/test/fixture-multi'), copy, {
      recursive: true,
    });
    await session(path.join(copy, 'hashmark.code-workspace'), 'multiroot.test.js');
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
