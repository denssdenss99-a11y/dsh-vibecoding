import test from 'node:test';
import assert from 'node:assert/strict';

test('security validations for command execution in run_tdd_cycle', () => {
  const SHELL_META_REGEX = /[\r\n;&|><`$%^]/;
  const DANGEROUS_FLAG_REGEX = /^-(e|c|r|m)$|^--(eval|require|import|loader|experimental-loader)$|^-(e|c|r|m)=|^--(eval|require|import|loader|experimental-loader)=|^-c.+|^-m.+/i;

  // 1. Shell metacharacters
  assert.equal(SHELL_META_REGEX.test('npm test && rm -rf /'), true);
  assert.equal(SHELL_META_REGEX.test('npm test ; ls'), true);
  assert.equal(SHELL_META_REGEX.test('npm test | grep ok'), true);
  assert.equal(SHELL_META_REGEX.test('npm test > out.txt'), true);
  assert.equal(SHELL_META_REGEX.test('npm test `whoami`'), true);
  assert.equal(SHELL_META_REGEX.test('npm test $VAR'), true);
  assert.equal(SHELL_META_REGEX.test('npm test --flag'), false);

  // 2. Dangerous execution flags
  const dangerous = [
    '-e', '--eval',
    '-c', '-c"import os; os.system(\'rm\')"', '-c=1',
    '-r', '--require', '--require=lodash',
    '-m', '-m=http.server', '-mhttp.server',
    '--import', '--import=./evil.js',
    '--loader', '--loader=ts-node/esm',
    '--experimental-loader', '--experimental-loader=./evil.mjs'
  ];

  for (const flag of dangerous) {
    assert.equal(DANGEROUS_FLAG_REGEX.test(flag), true, `Should block flag: ${flag}`);
  }

  // 3. Allowed legitimate test flags
  const allowed = [
    '--coverage',
    '-v',
    '--verbose',
    '-k',
    'test_user',
    '--grep=auth',
    '--bail',
    '--watch=false',
    '-s',
    '--runInBand'
  ];

  for (const flag of allowed) {
    assert.equal(DANGEROUS_FLAG_REGEX.test(flag), false, `Should allow flag: ${flag}`);
  }
});

test('relative executable path detection for test runners', () => {
  const isRelative = (cmd) => cmd.startsWith('.') || (cmd.includes('/') && !cmd.startsWith('/')) || (cmd.includes('\\') && !cmd.match(/^[a-zA-Z]:\\/));

  assert.equal(isRelative('./node'), true);
  assert.equal(isRelative('../bin/pytest'), true);
  assert.equal(isRelative('subdir/runner'), true);
  assert.equal(isRelative('npm'), false);
  assert.equal(isRelative('pytest'), false);
  assert.equal(isRelative('/usr/local/bin/node'), false);
});
