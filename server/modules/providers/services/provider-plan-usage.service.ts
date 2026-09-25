import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { codexAppServer } from '@/modules/providers/list/codex/codex-app-server.client.js';
import type { LLMProvider } from '@/shared/types.js';
import { readObjectRecord } from '@/shared/utils.js';

/** One plan window: percentage spent, its length, and the Unix reset time when known. */
type PlanWindow = { used_percent: number; window_minutes: number; resets_at?: number };
/** A weekly window that only counts one model or surface, e.g. Claude's separate Fable allowance. */
type ScopedPlanWindow = PlanWindow & { scope: string };
/**
 * The five-hour (`primary`) and weekly (`secondary`) windows, in the shape
 * Codex session snapshots already use, plus any model-scoped weekly windows
 * the account carries on top of them.
 */
type PlanUsage = { primary?: PlanWindow; secondary?: PlanWindow; scoped?: ScopedPlanWindow[] };

/** How long one provider answer is reused across clients before it is fetched again. */
const PLAN_USAGE_CACHE_TTL_MS = 30_000;
const FIVE_HOURS_IN_MINUTES = 300;
const SEVEN_DAYS_IN_MINUTES = 10_080;

/** Reads a percentage that may arrive as a number or numeric string; anything outside 0..100 is not a usage figure. */
const readPercent = (value: unknown): number | null => {
  const percent = typeof value === 'string' ? Number(value) : value;
  return typeof percent === 'number' && Number.isFinite(percent) && percent >= 0 && percent <= 100
    ? Math.round(percent)
    : null;
};

/** Accepts ISO strings, Unix seconds, or Unix milliseconds and returns Unix seconds. */
const readResetSeconds = (value: unknown): number | undefined => {
  const millis = typeof value === 'string' ? Date.parse(value) : Number(value);
  if (!Number.isFinite(millis) || millis <= 0) {
    return undefined;
  }
  return millis > 10_000_000_000 ? Math.floor(millis / 1000) : millis;
};

const buildWindow = (
  percent: unknown,
  windowMinutes: number,
  resetsAt: unknown,
): PlanWindow | undefined => {
  const usedPercent = readPercent(percent);
  if (usedPercent === null) {
    return undefined;
  }
  const resetSeconds = readResetSeconds(resetsAt);
  return {
    used_percent: usedPercent,
    window_minutes: windowMinutes,
    ...(resetSeconds !== undefined ? { resets_at: resetSeconds } : {}),
  };
};

const buildPlanUsage = (
  primary?: PlanWindow,
  secondary?: PlanWindow,
  scoped: ScopedPlanWindow[] = [],
): PlanUsage | null => (
  primary || secondary || scoped.length > 0
    ? {
      ...(primary ? { primary } : {}),
      ...(secondary ? { secondary } : {}),
      ...(scoped.length > 0 ? { scoped } : {}),
    }
    : null
);

/**
 * Translates the `limits` list of the Claude OAuth usage payload, which is
 * where model-scoped windows (e.g. a separate weekly Fable allowance) live.
 * Returns null when the payload predates that list so the caller can fall
 * back to the flat `five_hour` / `seven_day` fields.
 */
const normalizeClaudeLimits = (limits: unknown): PlanUsage | null => {
  if (!Array.isArray(limits)) {
    return null;
  }

  let primary: PlanWindow | undefined;
  let secondary: PlanWindow | undefined;
  const scoped: ScopedPlanWindow[] = [];
  for (const entry of limits) {
    const limit = readObjectRecord(entry);
    if (!limit) {
      continue;
    }
    const scope = readObjectRecord(limit.scope);
    const scopeName = readObjectRecord(scope?.model)?.display_name ?? scope?.surface;
    if (limit.kind === 'session') {
      primary ??= buildWindow(limit.percent, FIVE_HOURS_IN_MINUTES, limit.resets_at);
    } else if (limit.kind === 'weekly_all') {
      secondary ??= buildWindow(limit.percent, SEVEN_DAYS_IN_MINUTES, limit.resets_at);
    } else if (limit.group === 'weekly' && typeof scopeName === 'string' && scopeName.trim()) {
      const window = buildWindow(limit.percent, SEVEN_DAYS_IN_MINUTES, limit.resets_at);
      if (window) {
        scoped.push({ ...window, scope: scopeName.trim() });
      }
    }
  }
  return buildPlanUsage(primary, secondary, scoped);
};

/**
 * Used by the plan-usage service and its tests to translate the Claude OAuth
 * usage payload. Claude reports `utilization` and `percent` as percentages
 * (11 means 11%), not fractions.
 */
export function normalizeClaudePlanUsage(value: unknown): PlanUsage | null {
  const usage = readObjectRecord(value);
  const fromLimits = normalizeClaudeLimits(usage?.limits);
  if (fromLimits) {
    return fromLimits;
  }

  const fiveHour = readObjectRecord(usage?.five_hour);
  const sevenDay = readObjectRecord(usage?.seven_day);
  return buildPlanUsage(
    buildWindow(fiveHour?.utilization, FIVE_HOURS_IN_MINUTES, fiveHour?.resets_at),
    buildWindow(sevenDay?.utilization, SEVEN_DAYS_IN_MINUTES, sevenDay?.resets_at),
  );
}

/**
 * Used by the plan-usage service and its tests to translate the Codex
 * app-server `account/rateLimits/read` result. Window lengths come from the
 * payload because Codex plans do not all share the same secondary window.
 */
export function normalizeCodexPlanUsage(value: unknown): PlanUsage | null {
  const rateLimits = readObjectRecord(readObjectRecord(value)?.rateLimits);
  const primary = readObjectRecord(rateLimits?.primary);
  const secondary = readObjectRecord(rateLimits?.secondary);
  const readWindow = (window: ReturnType<typeof readObjectRecord>, fallbackMinutes: number) => {
    const minutes = Number(window?.windowDurationMins);
    return buildWindow(
      window?.usedPercent,
      Number.isFinite(minutes) && minutes > 0 ? minutes : fallbackMinutes,
      window?.resetsAt,
    );
  };
  return buildPlanUsage(
    readWindow(primary, FIVE_HOURS_IN_MINUTES),
    readWindow(secondary, SEVEN_DAYS_IN_MINUTES),
  );
}

async function readClaudeAccessToken(): Promise<string | null> {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) {
    return process.env.CLAUDE_CODE_OAUTH_TOKEN.trim();
  }
  try {
    const credentials = readObjectRecord(JSON.parse(await readFile(
      path.join(os.homedir(), '.claude', '.credentials.json'),
      'utf8',
    )));
    const oauth = readObjectRecord(credentials?.claudeAiOauth);
    if (typeof oauth?.expiresAt === 'number' && oauth.expiresAt <= Date.now()) {
      return null;
    }
    return typeof oauth?.accessToken === 'string' ? oauth.accessToken : null;
  } catch {
    return null;
  }
}

async function fetchClaudePlanUsage(): Promise<PlanUsage | null> {
  const token = await readClaudeAccessToken();
  if (!token) {
    return null;
  }

  const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'anthropic-beta': 'oauth-2025-04-20',
      'anthropic-version': '2023-06-01',
    },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    return null;
  }
  return normalizeClaudePlanUsage(await response.json());
}

async function fetchCodexPlanUsage(): Promise<PlanUsage | null> {
  return normalizeCodexPlanUsage(await codexAppServer.readAccountRateLimits());
}

/** Providers whose CLI exposes account-wide plan windows; the others only know per-session tokens. */
const PLAN_USAGE_FETCHERS: Partial<Record<LLMProvider, () => Promise<PlanUsage | null>>> = {
  claude: fetchClaudePlanUsage,
  codex: fetchCodexPlanUsage,
};

const planUsageCache = new Map<LLMProvider, { usage: PlanUsage | null; expiresAt: number }>();
// Concurrent clients (several tabs polling) share one in-flight fetch per provider.
const planUsageInflight = new Map<LLMProvider, Promise<PlanUsage | null>>();

/**
 * Used by provider routes to expose only the plan windows of the signed-in
 * account, never the credential that fetched them. Providers without plan
 * windows resolve to null so the UI simply shows the session context.
 */
export const providerPlanUsageService = {
  async getPlanUsage(provider: LLMProvider): Promise<PlanUsage | null> {
    const fetchPlanUsage = PLAN_USAGE_FETCHERS[provider];
    if (!fetchPlanUsage) {
      return null;
    }

    const cached = planUsageCache.get(provider);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.usage;
    }

    const inflight = planUsageInflight.get(provider);
    if (inflight) {
      return inflight;
    }

    const request = fetchPlanUsage()
      .catch((error: unknown) => {
        console.warn(`[Plan usage] Unable to read ${provider} plan usage:`, error);
        return null;
      })
      .then((usage) => {
        planUsageCache.set(provider, { usage, expiresAt: Date.now() + PLAN_USAGE_CACHE_TTL_MS });
        return usage;
      })
      .finally(() => {
        planUsageInflight.delete(provider);
      });
    planUsageInflight.set(provider, request);
    return request;
  },
};
