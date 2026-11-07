import type { EventEmitter } from 'node:events';
import * as path from 'node:path';
import { run as runTests } from 'node:test';
import { spec } from 'node:test/reporters';

type Result = {
  nesting: number;
  name: string;
  details?: { error?: { cause?: unknown; message?: string } };
};

export function run(): Promise<void> {
  const options: Parameters<typeof runTests>[0] & { isolation: 'none' } = {
    files: [path.resolve(__dirname, process.env.HASHMARK_TEST_FILE ?? 'extension.test.js')],
    isolation: 'none',
    concurrency: false,
  };
  const stream = runTests(options);
  stream.compose(new spec()).pipe(process.stdout);

  return new Promise((resolve, reject) => {
    const events = stream as unknown as EventEmitter;
    events.on('test:pass', ({ nesting }: Result) => nesting === 0 && resolve());
    events.on('test:fail', ({ name, details }: Result) =>
      console.log(`FAILED ${name}: ${details?.error?.cause ?? details?.error?.message}`),
    );
    events.on(
      'test:fail',
      ({ nesting }: Result) => nesting === 0 && setTimeout(() => reject(new Error('some tests failed')), 3000),
    );
  });
}
