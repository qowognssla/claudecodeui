import { useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { LLMProvider, ProviderPlanUsage } from '@/shared/types';

/** Providers whose CLI reports account-wide five-hour and weekly windows. */
const PROVIDERS_WITH_PLAN_USAGE: ReadonlySet<LLMProvider> = new Set<LLMProvider>(['claude', 'codex']);
const REFRESH_INTERVAL_MS = 60_000;

/**
 * Used by ChatInterface to show the signed-in account's plan windows in the
 * composer while its tab is active. Providers without plan windows resolve to
 * null so the composer falls back to the session context alone.
 */
export function useProviderPlanUsage(provider: LLMProvider, isActive: boolean): ProviderPlanUsage | null {
  const hasPlanUsage = PROVIDERS_WITH_PLAN_USAGE.has(provider);
  // Account-wide windows are separate from the per-session token budget the
  // transcript pages update, so they need their own polled value.
  const [planUsage, setPlanUsage] = useState<ProviderPlanUsage | null>(null);

  useEffect(() => {
    if (!hasPlanUsage || !isActive) {
      return;
    }
    let mounted = true;

    const refresh = async () => {
      try {
        const response = await api.providers.planUsage(provider);
        const payload = response.ok ? await response.json() : null;
        if (mounted) {
          setPlanUsage((payload?.data as ProviderPlanUsage | null) ?? null);
        }
      } catch {
        if (mounted) {
          setPlanUsage(null);
        }
      }
    };

    void refresh();
    const interval = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [provider, hasPlanUsage, isActive]);

  return hasPlanUsage && isActive ? planUsage : null;
}
