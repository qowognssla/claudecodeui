import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { ModelInfo, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import { buildDefaultProviderCurrentActiveModel, readObjectRecord, stripAnsiSequences } from '@/shared/utils.js';

/**
 * Ultracode is not one of the SDK's reasoning-effort levels. Selecting it runs the turn at
 * `xhigh` effort with standing dynamic-workflow orchestration, which the Claude runtime
 * translates into the session-scoped `ultracode` setting. It is therefore only offered on
 * models this catalog already marks as xhigh-capable.
 */
export const CLAUDE_ULTRACODE_EFFORT = 'ultracode';

const ULTRACODE_EFFORT_OPTION = {
  value: CLAUDE_ULTRACODE_EFFORT,
  description: 'Highest effort plus standing workflow orchestration.',
};

/**
 * Fallback catalog used by the runtime's effort validation and by
 * `getSupportedModels()` only while the Claude CLI cannot answer (not
 * installed, not logged in, or the discovery query timed out). The catalog the
 * UI normally shows comes from the CLI itself; see `ClaudeProviderModels`.
 */
export const CLAUDE_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'default',
      label: 'Default (recommended)',
      description: 'Use the recommended model for your Claude account and deployment.',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'best',
      label: 'Best available',
      description: 'Use Fable 5 when available, otherwise the latest Opus model.',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          ULTRACODE_EFFORT_OPTION,
        ],
      },
    },
    {
      value: 'fable',
      label: 'Fable 5',
      description: 'Most capable Claude model for the hardest, longest-running tasks.',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          ULTRACODE_EFFORT_OPTION,
        ],
      },
    },
    {
      value: 'sonnet',
      label: 'Sonnet',
      description: 'Latest Sonnet model for everyday coding tasks.',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          ULTRACODE_EFFORT_OPTION,
        ],
      },
    },
    {
      value: 'sonnet[1m]',
      label: 'Sonnet (1M context)',
      description: 'Latest Sonnet model with a 1M context window.',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          ULTRACODE_EFFORT_OPTION,
        ],
      },
    },
    {
      value: 'opus',
      label: 'Opus',
      description: 'Latest Opus model for complex reasoning and coding tasks.',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          ULTRACODE_EFFORT_OPTION,
        ],
      },
    },
    {
      value: 'opus[1m]',
      label: 'Opus (1M context)',
      description: 'Latest Opus model with a 1M context window.',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          ULTRACODE_EFFORT_OPTION,
        ],
      },
    },
    {
      value: 'haiku',
      label: 'Haiku',
      description: 'Fast and efficient Claude model for simple tasks.',
    },
    {
      value: 'opusplan',
      label: 'Opus Plan',
      description: 'Use Opus while planning, then switch to Sonnet for execution.',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          ULTRACODE_EFFORT_OPTION,
        ],
      },
    },
  ],
  DEFAULT: 'default',
};

export const findClaudeModelOption = (model: string | undefined | null): ProviderModelOption | null => {
  const normalizedModel = typeof model === 'string' ? model.trim() : '';
  if (!normalizedModel) {
    return null;
  }

  return CLAUDE_PREDEFINED_MODELS.OPTIONS.find((option) => option.value === normalizedModel) ?? null;
};
type ClaudeInitEvent = {
  sessionId?: string;
  session_id?: string;
  type?: string;
  subtype?: string;
  model?: string;
  message?: {
    content?: unknown;
    model?: string;
  };
};

/**
 * Claude Code stamps locally-synthesized rows (API-error placeholders and the
 * like) with `model: "<synthetic>"`. Angle-bracketed values are placeholders,
 * never real model ids, and must not be surfaced as the session's model.
 */
const isPlaceholderModel = (model: string): boolean => model.startsWith('<') && model.endsWith('>');

/** Exported for tests. */
export const extractClaudeEventModel = (event: ClaudeInitEvent, sessionId: string): string | null => {
  const eventSessionId = event.sessionId ?? event.session_id;
  if (eventSessionId && eventSessionId !== sessionId) {
    return null;
  }

  const contentModel = extractClaudeModelFromMessageContent(event.message?.content);
  if (contentModel) {
    return contentModel;
  }

  const directModel = event.model?.trim();
  if (directModel && !isPlaceholderModel(directModel)) {
    return directModel;
  }

  const messageModel = event.message?.model?.trim();
  return messageModel && !isPlaceholderModel(messageModel) ? messageModel : null;
};

const extractTaggedContent = (content: string, tagName: string): string | null => {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<${escapedTagName}>([\\s\\S]*?)<\\/${escapedTagName}>`).exec(content);
  return match ? match[1] : null;
};

const extractClaudeModelFromTextContent = (content: string): string | null => {
  const localCommandStdout = extractTaggedContent(content, 'local-command-stdout');
  if (localCommandStdout !== null) {
    const cleanedStdout = stripAnsiSequences(localCommandStdout).replace(/\s+/g, ' ').trim();
    const changedModel = /(?:set|changed|switched)\s+model\s+to\s+(.+?)\.?$/i.exec(cleanedStdout);
    const stdoutModel = changedModel?.[1]?.trim();
    // A placeholder stdout hit must not shadow a real <model> tag further down.
    if (stdoutModel && !isPlaceholderModel(stdoutModel)) {
      return stdoutModel;
    }
  }

  const modelTag = extractTaggedContent(content, 'model')?.trim();
  return modelTag && !isPlaceholderModel(modelTag) ? modelTag : null;
};

const extractClaudeModelFromMessageContent = (content: unknown): string | null => {
  if (typeof content === 'string') {
    return extractClaudeModelFromTextContent(content);
  }

  if (!Array.isArray(content)) {
    return null;
  }

  for (const part of content) {
    if (!part || typeof part !== 'object' || !('text' in part) || typeof part.text !== 'string') {
      continue;
    }

    // extractClaudeModelFromTextContent rejects placeholders, so a placeholder
    // part yields null here and a later part can still supply the real model.
    const model = extractClaudeModelFromTextContent(part.text);
    if (model) {
      return model;
    }
  }

  return null;
};

const readClaudeSessionModelFromJsonl = async (
  sessionId: string,
  jsonlPath: string,
): Promise<ProviderCurrentActiveModel | null> => {
  const content = await readFile(jsonlPath, 'utf8');
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const event = JSON.parse(lines[index]) as ClaudeInitEvent;
      const model = extractClaudeEventModel(event, sessionId);
      if (model) {
        return { model };
      }
    } catch {
      // Skip malformed JSONL lines that can happen during concurrent writes.
    }
  }

  return null;
};

/**
 * How long one discovery answer is reused before the catalog is rebuilt.
 * Short because the account's model roster can change server-side without
 * touching any local file.
 */
const CLI_MODELS_CACHE_TTL_MS = 2 * 60 * 1000;
/** Upper bound on one SDK discovery query; the next fallback is served past it. */
const CLI_MODELS_TIMEOUT_MS = 15_000;
/**
 * Working directory for the SDK discovery query. It must never be a user
 * project: anything the CLI wrote there would be filed under that project by
 * the session indexer.
 */
const CLI_MODELS_PROBE_CWD = path.join(os.tmpdir(), 'cloudcli-claude-models');
/**
 * The CLI folds the `model` chosen with `/model` into its answer, and
 * `default` resolves through it, so that file's mtime is part of the cache
 * key: a change there must show up on the next read, not after the TTL.
 */
const CLI_MODELS_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
/**
 * Where the Claude CLI caches the model catalog the server serves for the
 * signed-in account. It is the list the CLI's own `/model` picker shows, with
 * the account's real model versions, so it is the first source consulted.
 * Files are named `<org>-<hash>-<surface>.json`; `cc` is the Claude Code
 * surface.
 */
const CLI_MODEL_CATALOG_DIR = path.join(os.homedir(), '.claude', 'cache', 'model-catalog');
const CLI_MODEL_CATALOG_SUFFIX = '-cc.json';
/**
 * Models the CLI marks as natively supporting a 1M context window, which is
 * what its `[1m]` model suffix requires. Mirrors the CLI's baked-in catalog;
 * a model missing here simply gets no 1M variant in the picker.
 */
const NATIVE_1M_MODEL_IDS = new Set([
  'claude-opus-4-7',
  'claude-opus-4-8',
  'claude-opus-5',
  'claude-opus-5-5',
  'claude-sonnet-5',
  'claude-fable-5',
  'claude-fable-5-1',
  'claude-mythos-5',
  'claude-mythos-5-1',
]);
/** Effort choices offered on `default` when the CLI's configured model is unknown. */
const FULL_EFFORT_CHOICES: NonNullable<ProviderModelOption['effort']> = {
  default: 'high',
  values: [
    { value: 'low' },
    { value: 'medium' },
    { value: 'high' },
    { value: 'xhigh' },
    { value: 'max' },
    ULTRACODE_EFFORT_OPTION,
  ],
};

/** Discovery boundaries so tests can substitute the CLI answers. */
type ClaudeCliModelsFetcher = () => Promise<ModelInfo[]>;
type ClaudeServedCatalogReader = () => Promise<{ catalog: unknown; stamp: number } | null>;

const readTrimmedString = (value: unknown): string | undefined => (
  typeof value === 'string' && value.trim() ? value.trim() : undefined
);

/** Cheap fingerprint of the local settings the answer depends on; 0 when the file is absent. */
async function readClaudeSettingsStamp(): Promise<number> {
  try {
    return (await stat(CLI_MODELS_SETTINGS_PATH)).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Loads the newest cached Claude Code catalog, or null when the CLI has not
 * cached one yet (fresh install, never signed in). `stamp` is the file's mtime
 * so callers can tell a refreshed cache from the one they already built on.
 */
async function readClaudeServedCatalog(): Promise<{ catalog: unknown; stamp: number } | null> {
  let entries: string[];
  try {
    entries = await readdir(CLI_MODEL_CATALOG_DIR);
  } catch {
    return null;
  }

  let newest: { catalog: unknown; stamp: number; fetchedAt: number } | null = null;
  for (const entry of entries) {
    if (!entry.endsWith(CLI_MODEL_CATALOG_SUFFIX)) {
      continue;
    }
    const filePath = path.join(CLI_MODEL_CATALOG_DIR, entry);
    try {
      const [content, info] = await Promise.all([readFile(filePath, 'utf8'), stat(filePath)]);
      const parsed: unknown = JSON.parse(content);
      const fetchedAt = Number(readObjectRecord(parsed)?.fetchedAt) || info.mtimeMs;
      if (!newest || fetchedAt > newest.fetchedAt) {
        newest = { catalog: parsed, stamp: info.mtimeMs, fetchedAt };
      }
    } catch {
      // A half-written or foreign file in the cache directory is not a catalog.
    }
  }
  return newest ? { catalog: newest.catalog, stamp: newest.stamp } : null;
}

/**
 * Maps one served-catalog model onto catalog rows: the model itself and, when
 * the CLI supports it, its `[1m]` variant. Effort levels and their default
 * come from the catalog's own `thinking` block; ultracode is added on
 * xhigh-capable models as with every other Claude source.
 */
const toServedCatalogOptions = (
  model: Record<string, unknown>,
  effortByModel: Record<string, string>,
): ProviderModelOption[] => {
  const id = readTrimmedString(model.id);
  if (!id) {
    return [];
  }
  const name = readTrimmedString(model.name) ?? id;
  const shortName = readTrimmedString(model.short_name);
  const description = readTrimmedString(model.description)
    ?? (model.section === 'overflow' && shortName ? `Previous ${shortName} version` : undefined);

  const thinking = readObjectRecord(model.thinking);
  const levels: string[] = [];
  let badgedDefault: string | undefined;
  for (const rawOption of Array.isArray(thinking?.effort_options) ? thinking.effort_options : []) {
    const option = readObjectRecord(rawOption);
    const level = readTrimmedString(option?.id);
    if (!level) {
      continue;
    }
    levels.push(level);
    if (readObjectRecord(option?.badge)?.message === 'Default') {
      badgedDefault = level;
    }
  }
  const effort = levels.length > 0
    ? {
      default: badgedDefault ?? effortByModel[id] ?? (levels.includes('high') ? 'high' : levels[0]),
      values: [
        ...levels.map((value) => ({ value })),
        ...(levels.includes('xhigh') ? [ULTRACODE_EFFORT_OPTION] : []),
      ],
    }
    : undefined;

  const base: ProviderModelOption = {
    value: id,
    label: name,
    ...(description ? { description } : {}),
    ...(effort ? { effort } : {}),
  };
  if (!NATIVE_1M_MODEL_IDS.has(id)) {
    return [base];
  }
  return [base, { ...base, value: `${id}[1m]`, label: `${name} (1M context)` }];
};

/**
 * Exported for tests. Builds the catalog from one cached served-catalog file
 * (`{ fetchedAt, catalog: { config: { models }, state } }`). Main-section
 * models come first, then the older "overflow" ones, mirroring the CLI's
 * picker; disabled and deprecated rows are dropped. Returns null when the file
 * lists no usable model so the caller can fall through.
 */
export const buildClaudeModelsFromServedCatalog = (raw: unknown): ProviderModelsDefinition | null => {
  const catalog = readObjectRecord(readObjectRecord(raw)?.catalog);
  const config = readObjectRecord(catalog?.config);
  const state = readObjectRecord(catalog?.state);

  const effortByModel: Record<string, string> = {};
  for (const rawEntry of Array.isArray(state?.thinking_by_model) ? state.thinking_by_model : []) {
    const entry = readObjectRecord(rawEntry);
    const id = readTrimmedString(entry?.id);
    const effort = readTrimmedString(readObjectRecord(entry?.thinking)?.effort);
    if (id && effort) {
      effortByModel[id] = effort;
    }
  }

  const models = (Array.isArray(config?.models) ? config.models : [])
    .map((entry) => readObjectRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .filter((entry) => entry.disabled !== true && entry.section !== 'deprecated');
  const ordered = [
    ...models.filter((entry) => entry.section !== 'overflow'),
    ...models.filter((entry) => entry.section === 'overflow'),
  ];
  const options = ordered.flatMap((entry) => toServedCatalogOptions(entry, effortByModel));
  if (options.length === 0) {
    return null;
  }

  // `default` hands the choice to the CLI, which runs the model saved in its
  // own settings; the catalog records that choice so the row can say so.
  const settingModel = readTrimmedString(state?.model);
  const settingOption = settingModel
    ? options.find((option) => option.value === settingModel)
      ?? options.find((option) => option.value === settingModel.replace(/\[1m\]$/i, ''))
    : undefined;
  const defaultOption: ProviderModelOption = {
    value: CLAUDE_PREDEFINED_MODELS.DEFAULT,
    label: 'Default (recommended)',
    description: settingOption
      ? `${settingOption.label} · Set in your Claude CLI settings`
      : 'Use the model configured in the Claude CLI.',
    effort: settingOption?.effort ?? FULL_EFFORT_CHOICES,
  };
  return { OPTIONS: [defaultOption, ...options], DEFAULT: CLAUDE_PREDEFINED_MODELS.DEFAULT };
};

/**
 * Asks the Claude CLI which models this account may use. Second source: the
 * CLI answers this from its built-in alias table before it has loaded the
 * served catalog, so version labels here can lag the picker's.
 *
 * The prompt is a stream that never yields a message: the CLI boots, answers
 * the `supportedModels` control request, and is aborted before any turn can
 * start, so no transcript, title, or API call is produced. Session
 * persistence is disabled as a second guard.
 */
async function fetchClaudeCliModels(): Promise<ModelInfo[]> {
  await mkdir(CLI_MODELS_PROBE_CWD, { recursive: true });
  const abortController = new AbortController();
  async function* idlePrompt(): AsyncGenerator<SDKUserMessage> {
    await new Promise<void>((resolve) => {
      abortController.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    // Only reached after the abort, and yields nothing: no user message ever
    // reaches the CLI.
    yield* [] as SDKUserMessage[];
  }

  const instance = query({
    prompt: idlePrompt(),
    options: { cwd: CLI_MODELS_PROBE_CWD, persistSession: false, abortController },
  });

  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      instance.supportedModels(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Claude CLI did not list its models within ${CLI_MODELS_TIMEOUT_MS}ms`)),
          CLI_MODELS_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    abortController.abort();
    instance.close();
  }
}

/** Exported for tests. Maps one CLI model row onto the app's catalog row shape. */
export const toClaudeModelOption = (model: ModelInfo): ProviderModelOption => {
  const levels = model.supportsEffort ? model.supportedEffortLevels ?? [] : [];
  const values: { value: string; description?: string }[] = levels.map((value) => ({ value }));
  if (levels.includes('xhigh')) {
    values.push(ULTRACODE_EFFORT_OPTION);
  }

  return {
    value: model.value,
    label: model.displayName,
    description: model.description,
    ...(values.length > 0
      ? { effort: { default: levels.includes('high') ? 'high' : levels[0], values } }
      : {}),
  };
};

/** Exported for tests. Builds the catalog from a CLI answer; an empty answer is not a catalog. */
export const buildClaudeModelsDefinition = (models: ModelInfo[]): ProviderModelsDefinition | null => {
  const options = models
    .filter((model) => typeof model.value === 'string' && model.value.trim() && model.displayName)
    .map(toClaudeModelOption);
  if (options.length === 0) {
    return null;
  }

  const hasDefault = options.some((option) => option.value === CLAUDE_PREDEFINED_MODELS.DEFAULT);
  return {
    OPTIONS: options,
    DEFAULT: hasDefault ? CLAUDE_PREDEFINED_MODELS.DEFAULT : options[0].value,
  };
};

export class ClaudeProviderModels implements IProviderModels {
  private readonly fetchCliModels: ClaudeCliModelsFetcher;
  private readonly readServedCatalog: ClaudeServedCatalogReader;
  private cached: {
    definition: ProviderModelsDefinition;
    expiresAt: number;
    /** Settings mtime plus served-catalog mtime the cached answer was built from. */
    stamp: string;
  } | null = null;
  // One discovery at a time: concurrent callers share the in-flight work.
  private inflight: Promise<ProviderModelsDefinition> | null = null;

  constructor(
    fetchCliModels: ClaudeCliModelsFetcher = fetchClaudeCliModels,
    readServedCatalog: ClaudeServedCatalogReader = readClaudeServedCatalog,
  ) {
    this.fetchCliModels = fetchCliModels;
    this.readServedCatalog = readServedCatalog;
  }

  /**
   * The catalog the Claude CLI shows for the signed-in account, so the picker
   * lists the same models and versions as the CLI's own `/model`. Sources in
   * order: the CLI's cached served catalog, the CLI's `supportedModels`
   * answer, and finally the predefined alias catalog.
   */
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const [settingsStamp, served] = await Promise.all([
      readClaudeSettingsStamp(),
      this.readServedCatalog().catch(() => null),
    ]);
    const stamp = `${settingsStamp}:${served?.stamp ?? 0}`;
    if (this.cached && this.cached.expiresAt > Date.now() && this.cached.stamp === stamp) {
      return this.cached.definition;
    }

    if (!this.inflight) {
      this.inflight = this.discover(served?.catalog, stamp).finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async discover(servedCatalog: unknown, stamp: string): Promise<ProviderModelsDefinition> {
    const fromServedCatalog = servedCatalog === undefined
      ? null
      : buildClaudeModelsFromServedCatalog(servedCatalog);
    if (fromServedCatalog) {
      this.cached = { definition: fromServedCatalog, expiresAt: Date.now() + CLI_MODELS_CACHE_TTL_MS, stamp };
      return fromServedCatalog;
    }

    try {
      const definition = buildClaudeModelsDefinition(await this.fetchCliModels());
      if (definition) {
        this.cached = { definition, expiresAt: Date.now() + CLI_MODELS_CACHE_TTL_MS, stamp };
        return definition;
      }
      console.warn('[Claude models] The CLI listed no models; serving the fallback catalog.');
    } catch (error) {
      console.warn('[Claude models] Unable to list models from the Claude CLI; serving the fallback catalog:', error);
    }
    // A stale CLI answer still beats the fallback: keep serving it until the CLI recovers.
    return this.cached?.definition ?? CLAUDE_PREDEFINED_MODELS;
  }

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    if (!sessionId?.trim()) {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }

    try {
      const jsonlPath = sessionsDb.getSessionById(sessionId)?.jsonl_path;
      const activeModel = jsonlPath
        ? await readClaudeSessionModelFromJsonl(sessionId, jsonlPath)
        : null;
      if (activeModel?.model) {
        return activeModel;
      }
    } catch {
      // Fall through to the provider default when the session-backed lookup fails.
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
