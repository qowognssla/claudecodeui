import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CodexProviderModels,
  CODEX_PREDEFINED_MODELS,
} from '@/modules/providers/list/codex/codex-models.provider.js';

/**
 * Runs one case against a throwaway `CODEX_HOME`, so the catalog depends on the
 * fixture rather than on the models cached on the machine running the suite.
 */
const withCodexHome = async (
  setUp: (codexHome: string) => Promise<void>,
  runTest: (adapter: CodexProviderModels) => Promise<void>,
): Promise<void> => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), 'codex-catalog-'));
  const originalCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;

  try {
    await setUp(codexHome);
    await runTest(new CodexProviderModels());
  } finally {
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }
    await rm(codexHome, { recursive: true, force: true });
  }
};

const writeModelsCache = async (codexHome: string, models: unknown): Promise<void> => {
  await writeFile(path.join(codexHome, 'models_cache.json'), JSON.stringify({ models }), 'utf8');
};

test('Codex falls back to the curated catalog without a models cache', async () => {
  await withCodexHome(async () => {}, async (adapter) => {
    assert.deepEqual(await adapter.getSupportedModels(), CODEX_PREDEFINED_MODELS);
  });
});

test('Codex falls back to the curated catalog when the cache is malformed', async () => {
  await withCodexHome(async (codexHome) => {
    await writeFile(path.join(codexHome, 'models_cache.json'), '{not json', 'utf8');
  }, async (adapter) => {
    assert.deepEqual(await adapter.getSupportedModels(), CODEX_PREDEFINED_MODELS);
  });
});

test('Codex lists visible cached models in priority order with their efforts', async () => {
  await withCodexHome(async (codexHome) => {
    await writeModelsCache(codexHome, [
      {
        slug: 'gpt-6-luna',
        display_name: 'GPT-6-Luna',
        description: 'Fast model.',
        default_reasoning_level: 'medium',
        supported_reasoning_levels: [{ effort: 'low', description: 'Quick' }, { effort: 'medium' }],
        visibility: 'list',
        priority: 3,
      },
      { slug: 'codex-auto-review', visibility: 'hide', priority: 1 },
      {
        slug: 'gpt-6-sol',
        display_name: 'GPT-6-Sol',
        default_reasoning_level: 'ultra',
        supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }],
        visibility: 'list',
        priority: 2,
      },
      { slug: 'gpt-5.6-sol', display_name: 'GPT-5.6-Sol', visibility: 'list', priority: 4 },
    ]);
  }, async (adapter) => {
    const catalog = await adapter.getSupportedModels();

    assert.deepEqual(catalog.OPTIONS.map((option) => option.value), ['gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol']);
    assert.equal(catalog.DEFAULT, CODEX_PREDEFINED_MODELS.DEFAULT);

    const [sol, luna, curatedSol] = catalog.OPTIONS;
    assert.equal(sol.label, 'GPT-6 Sol');
    // An advertised default the model does not support falls back to its first effort.
    assert.deepEqual(sol.effort, { default: 'low', values: [{ value: 'low' }, { value: 'high' }] });
    assert.deepEqual(luna.effort, {
      default: 'medium',
      values: [{ value: 'low', description: 'Quick' }, { value: 'medium' }],
    });
    // Curated models keep their label, and their efforts when the cache lists none.
    const curated = CODEX_PREDEFINED_MODELS.OPTIONS.find((option) => option.value === 'gpt-5.6-sol');
    assert.equal(curatedSol.label, curated?.label);
    assert.deepEqual(curatedSol.effort, curated?.effort);
  });
});

test('Codex defaults to the first cached model when the curated default is absent', async () => {
  await withCodexHome(async (codexHome) => {
    await writeModelsCache(codexHome, [{ slug: 'gpt-7', visibility: 'list', priority: 1 }]);
  }, async (adapter) => {
    const catalog = await adapter.getSupportedModels();
    assert.equal(catalog.DEFAULT, 'gpt-7');
    assert.deepEqual(catalog.OPTIONS, [{ value: 'gpt-7', label: 'gpt-7', description: undefined, effort: undefined }]);
  });
});
