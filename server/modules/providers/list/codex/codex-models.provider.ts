import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';

import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

/**
 * Curated Codex catalog shipped as immutable CloudCLI defaults. Used when the
 * Codex CLI's own model cache is unavailable, and as the source of labels for
 * cached models it already knows.
 */
export const CODEX_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'gpt-6-astra',
      label: 'GPT-6 Astra',
      description: 'Our most capable model for complex, demanding work.',
      effort: {
        default: 'low',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-5.6-sol',
      label: 'GPT-5.6 Sol',
      description: 'Latest frontier agentic coding model.',
      effort: {
        default: 'low',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-5.6-terra',
      label: 'GPT-5.6 Terra',
      description: 'Balanced agentic coding model for everyday work.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-5.6-luna',
      label: 'GPT-5.6 Luna',
      description: 'Fast and affordable agentic coding model.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'gpt-5.5',
      label: 'GPT-5.5',
      description: 'Frontier model for complex coding, research, and real-world work.',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
    {
      value: 'gpt-5.4',
      label: 'GPT-5.4',
      description: 'Strong model for everyday coding.',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
    {
      value: 'gpt-5.4-mini',
      label: 'GPT-5.4 Mini',
      description: 'Small, fast, and cost-efficient model for simpler coding tasks.',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
  ],
  DEFAULT: 'gpt-5.6-sol',
};

/**
 * Codex keeps its state under `$CODEX_HOME` (default `~/.codex`). Resolved per
 * call so tests and relocated installs see the current home.
 */
const resolveCodexHome = (): string => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

/**
 * Reads the model catalog the Codex CLI caches from its backend
 * (`models_cache.json`), so models the account can use appear without a
 * CloudCLI release. Returns null when the cache is missing, unreadable, or
 * lists no visible models, letting callers fall back to the curated catalog.
 */
const readCodexCachedModels = async (): Promise<ProviderModelOption[] | null> => {
  try {
    const raw = await readFile(path.join(resolveCodexHome(), 'models_cache.json'), 'utf8');
    const parsed = readObjectRecord(JSON.parse(raw));
    if (!Array.isArray(parsed?.models)) {
      return null;
    }

    const entries = parsed.models
      .map((entry: unknown) => readObjectRecord(entry))
      .filter((entry): entry is NonNullable<typeof entry> => (
        entry !== null
        && readOptionalString(entry.slug) !== undefined
        // `hide` marks internal models (auto review, reserve) the Codex picker omits too.
        && entry.visibility !== 'hide'
      ))
      .sort((a, b) => (
        (typeof a.priority === 'number' ? a.priority : Number.MAX_SAFE_INTEGER)
        - (typeof b.priority === 'number' ? b.priority : Number.MAX_SAFE_INTEGER)
      ));

    const options = entries.map((entry): ProviderModelOption => {
      const value = readOptionalString(entry.slug) as string;
      const curated = CODEX_PREDEFINED_MODELS.OPTIONS.find((option) => option.value === value);
      const efforts = (Array.isArray(entry.supported_reasoning_levels) ? entry.supported_reasoning_levels : [])
        .map((level: unknown) => readObjectRecord(level))
        .map((level) => ({
          value: readOptionalString(level?.effort),
          description: readOptionalString(level?.description),
        }))
        .filter((level): level is { value: string; description: string | undefined } => level.value !== undefined)
        .map(({ value: effortValue, description }) => (description ? { value: effortValue, description } : { value: effortValue }));

      const defaultEffort = readOptionalString(entry.default_reasoning_level);
      return {
        value,
        // The cache hyphenates display names ("GPT-6-Sol"); match the curated "GPT-6 Sol" style.
        label: curated?.label
          ?? readOptionalString(entry.display_name)?.replace(/-(?=[A-Z][a-z])/g, ' ')
          ?? value,
        description: readOptionalString(entry.description) ?? curated?.description,
        effort: efforts.length > 0
          ? {
            default: defaultEffort && efforts.some((effort) => effort.value === defaultEffort)
              ? defaultEffort
              : efforts[0].value,
            values: efforts,
          }
          : curated?.effort,
      };
    });

    return options.length > 0 ? options : null;
  } catch {
    return null;
  }
};

/** Provider registry model adapter for Codex predefined models and active config. */
export class CodexProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const cached = await readCodexCachedModels();
    if (!cached) {
      return CODEX_PREDEFINED_MODELS;
    }

    return {
      OPTIONS: cached,
      DEFAULT: cached.some((option) => option.value === CODEX_PREDEFINED_MODELS.DEFAULT)
        ? CODEX_PREDEFINED_MODELS.DEFAULT
        : cached[0].value,
    };
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    try {
      const raw = await readFile(path.join(resolveCodexHome(), 'config.toml'), 'utf8');
      const parsed = readObjectRecord(TOML.parse(raw));
      const model = readOptionalString(parsed?.model);
      if (!model) {
        return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
      }

      return {
        model,
      };
    } catch {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }
  }
}
