import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { browserUseService } from '@/modules/browser-use/browser-use.service.js';
import { closeConnection } from '@/modules/database/index.js';

test('browser monitor list starts empty without agent sessions', async () => {
  const sessions = await browserUseService.listSessions();

  assert.deepEqual(sessions, []);
});

/**
 * Points HOME (which holds the Playwright runtime directory), DATABASE_PATH
 * and PATH at a scratch directory for one test, so nothing touches the real
 * home directory, database or npm.
 */
async function withScratchEnvironment(runTest: (scratch: string) => Promise<void>): Promise<void> {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-use-runtime-'));
  const previousEnv = {
    HOME: process.env.HOME,
    DATABASE_PATH: process.env.DATABASE_PATH,
    PATH: process.env.PATH,
    FAKE_NPM_LOG: process.env.FAKE_NPM_LOG,
  };

  closeConnection();
  process.env.HOME = path.join(scratch, 'home');
  process.env.DATABASE_PATH = path.join(scratch, 'auth.db');
  fs.mkdirSync(process.env.HOME, { recursive: true });
  // An existing (empty) database file stops the connection from copying the legacy database in.
  fs.writeFileSync(process.env.DATABASE_PATH, '');

  try {
    await runTest(scratch);
  } finally {
    closeConnection();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

const getRuntimeRoot = () => path.join(os.homedir(), '.cloudcli', 'browser-use', 'runtime');

// Runs before the install test: the readiness probe is cached, and installRuntime() refreshes it.
test('a Playwright installed in the runtime directory is used first', { skip: process.platform === 'win32' }, async () => {
  await withScratchEnvironment(async () => {
    const packageDirectory = path.join(getRuntimeRoot(), 'node_modules', 'playwright');
    fs.mkdirSync(packageDirectory, { recursive: true });
    fs.writeFileSync(path.join(packageDirectory, 'package.json'), JSON.stringify({ name: 'playwright', main: 'index.js' }));
    // Marks itself loaded, which tells it apart from a real Playwright CloudCLI can resolve on its own,
    // and reports an existing file as the Chromium executable.
    fs.writeFileSync(
      path.join(packageDirectory, 'index.js'),
      'globalThis.__runtimePlaywrightLoaded = true;\nmodule.exports = { chromium: { executablePath: () => process.execPath } };\n',
    );

    const status = await browserUseService.getStatus();

    assert.equal((globalThis as Record<string, unknown>).__runtimePlaywrightLoaded, true);
    assert.equal(status.playwrightInstalled, true);
    assert.equal(status.chromiumInstalled, true);
  });
});

test("installing the runtime runs npm in its own directory, never CloudCLI's", { skip: process.platform === 'win32' }, async () => {
  await withScratchEnvironment(async (scratch) => {
    const binDirectory = path.join(scratch, 'bin');
    const logPath = path.join(scratch, 'npm.log');
    fs.mkdirSync(binDirectory);
    // Stand-in npm: records where it ran and with which arguments, then succeeds.
    fs.writeFileSync(
      path.join(binDirectory, 'npm'),
      '#!/bin/sh\nprintf \'%s|%s\\n\' "$(pwd -P)" "$*" >> "$FAKE_NPM_LOG"\n',
      { mode: 0o755 },
    );
    process.env.PATH = `${binDirectory}${path.delimiter}${process.env.PATH ?? ''}`;
    process.env.FAKE_NPM_LOG = logPath;

    const result = await browserUseService.installRuntime();

    const runtimeRoot = fs.realpathSync(getRuntimeRoot());
    const calls = fs.readFileSync(logPath, 'utf8').trim().split('\n').map((line) => {
      const [cwd, args] = line.split('|');
      return { cwd, args };
    });
    assert.equal(result.success, true);
    assert.equal(calls[0]?.args, 'install --no-audit --no-fund playwright');
    assert.ok(calls.every((call) => call.cwd === runtimeRoot), JSON.stringify(calls));
    // Its own manifest keeps npm from walking up to some other project's package.json.
    assert.equal(JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'package.json'), 'utf8')).private, true);
  });
});
