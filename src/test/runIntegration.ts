import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main() {
  const root = path.resolve(__dirname, '../..');
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: path.resolve(__dirname, 'integration/index'),
    launchArgs: [path.join(root, 'src/test/fixture'), '--disable-extensions'],
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
