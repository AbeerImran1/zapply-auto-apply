import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const directories = ['src', 'test', 'scripts'];
const files = [];
for (const directory of directories) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
      files.push(path.join(directory, entry.name));
    }
  }
}
for (const file of files) {
  const check = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit', cwd: root });
  if (check.status !== 0) process.exit(check.status ?? 1);
}
const tests = spawnSync(process.execPath, ['--test'], { stdio: 'inherit', cwd: root });
process.exit(tests.status ?? 1);
