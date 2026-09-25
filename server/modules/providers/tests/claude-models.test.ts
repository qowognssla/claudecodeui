import assert from 'node:assert/strict';
import test from 'node:test';

import { extractClaudeEventModel } from '@/modules/providers/list/claude/claude-models.provider.js';

const SESSION_ID = 'session-1';

test('ignores the <synthetic> placeholder Claude Code stamps on synthesized rows', () => {
  assert.equal(
    extractClaudeEventModel(
      { sessionId: SESSION_ID, message: { model: '<synthetic>' } },
      SESSION_ID,
    ),
    null,
  );
  assert.equal(
    extractClaudeEventModel({ sessionId: SESSION_ID, model: '<synthetic>' }, SESSION_ID),
    null,
  );
});

test('still surfaces real model ids from message and event fields', () => {
  assert.equal(
    extractClaudeEventModel(
      { sessionId: SESSION_ID, message: { model: 'claude-sonnet-5' } },
      SESSION_ID,
    ),
    'claude-sonnet-5',
  );
  assert.equal(
    extractClaudeEventModel({ sessionId: SESSION_ID, model: 'opus' }, SESSION_ID),
    'opus',
  );
});

test('skips a placeholder content part so a later real model tag still wins', () => {
  assert.equal(
    extractClaudeEventModel(
      {
        sessionId: SESSION_ID,
        message: {
          content: [
            { text: '<model><synthetic></model>' },
            { text: '<model>claude-sonnet-5</model>' },
          ],
        },
      },
      SESSION_ID,
    ),
    'claude-sonnet-5',
  );
});

test('a placeholder stdout hit does not shadow a real <model> tag in the same text', () => {
  const text = '<local-command-stdout>Set model to <synthetic></local-command-stdout>'
    + '<model>claude-sonnet-5</model>';
  assert.equal(
    extractClaudeEventModel(
      { sessionId: SESSION_ID, message: { content: text } },
      SESSION_ID,
    ),
    'claude-sonnet-5',
  );
  assert.equal(
    extractClaudeEventModel(
      { sessionId: SESSION_ID, message: { content: [{ text }] } },
      SESSION_ID,
    ),
    'claude-sonnet-5',
  );
});

test('falls back to the message model when every content hit is a placeholder', () => {
  assert.equal(
    extractClaudeEventModel(
      {
        sessionId: SESSION_ID,
        message: {
          content: '<model><synthetic></model>',
          model: 'claude-sonnet-5',
        },
      },
      SESSION_ID,
    ),
    'claude-sonnet-5',
  );
});

test('the catalog comes from the Claude CLI, with ultracode offered on xhigh-capable models', async () => {
  const { ClaudeProviderModels, CLAUDE_ULTRACODE_EFFORT } = await import(
    '@/modules/providers/list/claude/claude-models.provider.js'
  );
  let calls = 0;
  const models = new ClaudeProviderModels(async () => {
    calls += 1;
    return [
      {
        value: 'default',
        displayName: 'Default (recommended)',
        description: 'Opus 4.8 with 1M context',
        supportsEffort: true,
        supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      },
      { value: 'haiku', displayName: 'Haiku', description: 'Haiku 4.5' },
      {
        value: 'claude-fable-5-1[1m]',
        displayName: 'Fable',
        description: 'Fable 5.1',
        supportsEffort: true,
        supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      },
    ];
  }, async () => null);

  const definition = await models.getSupportedModels();
  assert.equal(definition.DEFAULT, 'default');
  assert.deepEqual(definition.OPTIONS.map((option) => option.value), [
    'default',
    'haiku',
    'claude-fable-5-1[1m]',
  ]);
  assert.equal(definition.OPTIONS[1].effort, undefined);
  assert.equal(definition.OPTIONS[2].label, 'Fable');
  assert.equal(definition.OPTIONS[2].description, 'Fable 5.1');
  assert.equal(definition.OPTIONS[2].effort?.default, 'high');
  assert.deepEqual(
    definition.OPTIONS[2].effort?.values.map((value) => value.value),
    ['low', 'medium', 'high', 'xhigh', 'max', CLAUDE_ULTRACODE_EFFORT],
  );

  await models.getSupportedModels();
  assert.equal(calls, 1, 'a fresh CLI answer is reused instead of re-spawning the CLI');
});

test('the first CLI model becomes the default when the CLI has no "default" alias', async () => {
  const { ClaudeProviderModels } = await import(
    '@/modules/providers/list/claude/claude-models.provider.js'
  );
  const models = new ClaudeProviderModels(async () => [
    { value: 'sonnet', displayName: 'Sonnet', description: 'Sonnet 4.6' },
  ], async () => null);

  assert.equal((await models.getSupportedModels()).DEFAULT, 'sonnet');
});

test('the predefined catalog is served when the CLI cannot list models', async () => {
  const { ClaudeProviderModels, CLAUDE_PREDEFINED_MODELS } = await import(
    '@/modules/providers/list/claude/claude-models.provider.js'
  );
  const failing = new ClaudeProviderModels(async () => {
    throw new Error('claude is not installed');
  }, async () => null);
  assert.equal(await failing.getSupportedModels(), CLAUDE_PREDEFINED_MODELS);

  const empty = new ClaudeProviderModels(async () => [], async () => null);
  assert.equal(await empty.getSupportedModels(), CLAUDE_PREDEFINED_MODELS);
});

const SERVED_CATALOG = {
  fetchedAt: 1_790_304_004_861,
  catalog: {
    surface: 'cc',
    config: {
      id: 'cc',
      models: [
        {
          id: 'claude-opus-5-5',
          name: 'Opus 5.5',
          short_name: 'Opus',
          description: 'Most capable for ambitious work',
          section: 'main',
          thinking: {
            type: 'effort',
            effort_options: [
              { id: 'low', name: 'Low' },
              { id: 'medium', name: 'Medium', badge: { message: 'Default', variant: 'neutral' } },
              { id: 'high', name: 'High' },
              { id: 'xhigh', name: 'Extra' },
              { id: 'max', name: 'Max' },
            ],
          },
        },
        {
          id: 'claude-haiku-4-5-20251001',
          name: 'Haiku 4.5',
          short_name: 'Haiku',
          description: 'Fastest for quick answers',
          section: 'main',
          thinking: { type: 'none' },
        },
        { id: 'claude-opus-4-8', name: 'Opus 4.8', short_name: 'Opus', section: 'overflow',
          thinking: { type: 'effort', effort_options: [{ id: 'low' }, { id: 'high' }, { id: 'max' }] } },
        { id: 'claude-opus-3', name: 'Opus 3', short_name: 'Opus', section: 'deprecated' },
        { id: 'claude-sonnet-5', name: 'Sonnet 5', short_name: 'Sonnet', section: 'main', disabled: true },
      ],
    },
    state: {
      model: 'claude-opus-4-8',
      thinking_by_model: [{ id: 'claude-opus-4-8', thinking: { type: 'effort', effort: 'max' } }],
    },
  },
};

test('the served catalog the CLI caches wins over its alias table', async () => {
  const { ClaudeProviderModels, CLAUDE_ULTRACODE_EFFORT } = await import(
    '@/modules/providers/list/claude/claude-models.provider.js'
  );
  let cliCalls = 0;
  const models = new ClaudeProviderModels(async () => {
    cliCalls += 1;
    return [];
  }, async () => ({ catalog: SERVED_CATALOG, stamp: 1 }));

  const definition = await models.getSupportedModels();
  assert.equal(cliCalls, 0, 'the CLI is not spawned while a served catalog is available');
  assert.equal(definition.DEFAULT, 'default');
  assert.deepEqual(definition.OPTIONS.map((option) => option.value), [
    'default',
    'claude-opus-5-5',
    'claude-opus-5-5[1m]',
    'claude-haiku-4-5-20251001',
    'claude-opus-4-8',
    'claude-opus-4-8[1m]',
  ]);

  const [defaultRow, opus, opus1m, haiku, opus48] = definition.OPTIONS;
  assert.equal(defaultRow.description, 'Opus 4.8 · Set in your Claude CLI settings');
  assert.equal(defaultRow.effort?.default, 'max');
  assert.equal(opus.label, 'Opus 5.5');
  assert.equal(opus.description, 'Most capable for ambitious work');
  assert.equal(opus.effort?.default, 'medium', 'the catalog badge names the default effort');
  assert.deepEqual(
    opus.effort?.values.map((value) => value.value),
    ['low', 'medium', 'high', 'xhigh', 'max', CLAUDE_ULTRACODE_EFFORT],
  );
  assert.equal(opus1m.label, 'Opus 5.5 (1M context)');
  assert.equal(haiku.effort, undefined);
  assert.equal(opus48.description, 'Previous Opus version');
  assert.equal(opus48.effort?.default, 'max', 'the CLI-recorded per-model effort is the default when no badge is set');
});

test('a refreshed served catalog replaces the cached answer immediately', async () => {
  const { ClaudeProviderModels } = await import(
    '@/modules/providers/list/claude/claude-models.provider.js'
  );
  let stamp = 1;
  let catalog: unknown = SERVED_CATALOG;
  const models = new ClaudeProviderModels(async () => [], async () => ({ catalog, stamp }));

  assert.equal((await models.getSupportedModels()).OPTIONS[1].value, 'claude-opus-5-5');

  catalog = {
    catalog: { config: { models: [{ id: 'claude-fable-5-1', name: 'Fable 5.1', section: 'main' }] }, state: {} },
  };
  assert.equal((await models.getSupportedModels()).OPTIONS[1].value, 'claude-opus-5-5', 'same stamp: cached');

  stamp = 2;
  const refreshed = await models.getSupportedModels();
  assert.deepEqual(refreshed.OPTIONS.map((option) => option.value), ['default', 'claude-fable-5-1', 'claude-fable-5-1[1m]']);
  assert.equal(refreshed.OPTIONS[0].description, 'Use the model configured in the Claude CLI.');
});

test('an unusable served catalog falls through to the CLI alias table', async () => {
  const { ClaudeProviderModels } = await import(
    '@/modules/providers/list/claude/claude-models.provider.js'
  );
  const models = new ClaudeProviderModels(
    async () => [{ value: 'sonnet', displayName: 'Sonnet', description: 'Sonnet 4.6' }],
    async () => ({ catalog: { catalog: { config: { models: [] } } }, stamp: 1 }),
  );

  assert.deepEqual((await models.getSupportedModels()).OPTIONS.map((option) => option.value), ['sonnet']);
});
