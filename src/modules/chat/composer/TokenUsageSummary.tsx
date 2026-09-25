import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { getProviderPlanWindow, getProviderScopedPlanWindows } from '@/shared/utils';

type TokenUsageSummaryProps = {
  usage: Record<string, unknown> | null;
  onClick?: () => void;
};

const formatTokenCount = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }

  if (value >= 10_000) {
    return `${Math.round(value / 1_000)}K`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return value.toLocaleString();
};

const readUsageNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Rendered by chat's ChatComposer to show the session's context-window usage
 * and open the detailed token breakdown on click.
 */
function TokenUsageSummary({ usage, onClick }: TokenUsageSummaryProps) {
  const { t } = useTranslation();
  const breakdown =
    usage?.breakdown && typeof usage.breakdown === 'object'
      ? usage.breakdown as Record<string, unknown>
      : null;
  const inputTokens = readUsageNumber(usage?.inputTokens ?? breakdown?.input);
  const outputTokens = readUsageNumber(usage?.outputTokens ?? breakdown?.output);
  const usedTokens = readUsageNumber(usage?.used) || inputTokens + outputTokens;
  const contextUsed = Number(usage?.contextUsed);
  const contextTotal = Number(usage?.total);
  const hasRemaining = usage?.contextUsed != null
    && Number.isFinite(contextUsed)
    && Number.isFinite(contextTotal)
    && contextUsed >= 0
    && contextTotal > 0
    && contextUsed <= contextTotal;
  const remainingTokens = hasRemaining ? contextTotal - contextUsed : 0;
  const fiveHour = getProviderPlanWindow(usage?.rateLimits, 300);
  const weekly = getProviderPlanWindow(usage?.rateLimits, 10_080);
  const scopedWindows = getProviderScopedPlanWindows(usage?.rateLimits);
  const progress = fiveHour ? fiveHour.used_percent / 100
    : hasRemaining ? contextUsed / contextTotal : 0;
  const remainingLabel = t('chat:misc.tokensRemaining', {
    count: remainingTokens,
    formattedCount: formatTokenCount(remainingTokens),
    defaultValue: '{{formattedCount}} left',
  });
  const usedLabel = t('chat:misc.tokensUsedShort', {
    count: hasRemaining ? contextUsed : usedTokens,
    formattedCount: formatTokenCount(hasRemaining ? contextUsed : usedTokens),
    defaultValue: '{{formattedCount}} used',
  });
  const fiveHourLabel = fiveHour ? t('chat:misc.fiveHourRemaining', {
    percent: Math.round(100 - fiveHour.used_percent),
  }) : null;
  const weeklyLabel = weekly ? t('chat:misc.weeklyRemaining', {
    percent: Math.round(100 - weekly.used_percent),
  }) : null;
  // Model-scoped weekly allowances (e.g. Fable) sit after the account-wide ones.
  const scopedLabels = scopedWindows.map((window) => t('chat:misc.scopedWeeklyRemaining', {
    scope: window.scope,
    percent: Math.round(100 - window.used_percent),
  }));
  const planLabels = [weeklyLabel, ...scopedLabels].filter((value): value is string => Boolean(value));
  const contextLabel = hasRemaining ? `${usedLabel} · ${remainingLabel}`
    : usage && usedTokens > 0 ? usedLabel : null;
  const label = [fiveHourLabel, ...planLabels, contextLabel].filter(Boolean).join(' · ')
    || t('chat:misc.showTokenUsage');

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-background/70 px-2 text-xs text-muted-foreground shadow-sm transition-colors hover:border-primary/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:gap-2 sm:px-2.5"
      title={label}
      aria-label={`${t('chat:misc.showTokenUsage')}: ${label}`}
    >
      <svg aria-hidden="true" className="h-5 w-5 shrink-0 -rotate-90" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" className="text-muted-foreground/25" />
        <circle
          cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3"
          strokeLinecap="round" strokeDasharray={`${progress * 56.55} 56.55`}
          className="text-primary transition-all duration-300"
        />
      </svg>
      {fiveHourLabel ? (
        <>
          {/* Only the five-hour window is shown inline; the weekly and model-scoped windows stay in the tooltip and the usage modal. */}
          <span className="font-medium text-foreground">{fiveHourLabel}</span>
          {hasRemaining && <span className="hidden text-muted-foreground/70 sm:inline">· {remainingLabel}</span>}
        </>
      ) : hasRemaining ? (
        <>
          <span className="hidden font-medium text-foreground sm:inline">{usedLabel}</span>
          <span className="hidden text-muted-foreground/50 sm:inline">·</span>
          <span className="font-medium text-foreground">{remainingLabel}</span>
        </>
      ) : (
        <span className="font-medium text-foreground">{usage ? usedLabel : t('chat:misc.showTokenUsage')}</span>
      )}
    </button>
  );
}

/** Memoized: the composer re-renders on every keystroke and this row's numbers only move when a turn ends. */
export default memo(TokenUsageSummary);
