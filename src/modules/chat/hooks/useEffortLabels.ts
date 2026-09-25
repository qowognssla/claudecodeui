import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { ProviderEffortOption } from '@/shared/types';
import { DEFAULT_EFFORT_VALUE } from '@/shared/constants';

type EffortDisplay = {
  /** Key under `composer.effortLevels`; levels that mean the same thing on different CLIs share one. */
  labelKey: string;
  label: string;
  /** English fallback for `composer.effortDescriptions.<value>`. */
  description: string;
};

/**
 * One table for every provider, so Claude, Codex and OpenCode show the same
 * name and the same localized description for the same level. The Codex CLI
 * ships its own English descriptions; they are only shown for levels this
 * table does not know yet. `none`, `minimal` and `thinking` are OpenCode levels.
 */
const EFFORT_DISPLAY: Record<string, EffortDisplay> = {
  [DEFAULT_EFFORT_VALUE]: { labelKey: 'default', label: 'Default', description: "Use the CLI setting or the model's recommended effort" },
  none: { labelKey: 'none', label: 'None', description: 'Answer directly without extended reasoning' },
  minimal: { labelKey: 'minimal', label: 'Minimal', description: 'Fastest responses with almost no reasoning' },
  thinking: { labelKey: 'thinking', label: 'Thinking', description: 'Turn on the model\'s extended thinking' },
  low: { labelKey: 'low', label: 'Low', description: 'Fast responses with lighter reasoning' },
  medium: { labelKey: 'medium', label: 'Medium', description: 'Balances speed and reasoning depth' },
  high: { labelKey: 'high', label: 'High', description: 'Greater reasoning depth for complex problems' },
  xhigh: { labelKey: 'xhigh', label: 'Extra high', description: 'Extra reasoning depth for complex problems' },
  max: { labelKey: 'max', label: 'Max', description: 'Maximum reasoning depth for the hardest problems' },
  // Both CLIs top out above `max` with a level that does more than reason harder (Codex delegates,
  // Claude orchestrates workflows), so the two share the "Ultra" name but keep their own description.
  ultra: { labelKey: 'ultra', label: 'Ultra', description: 'Maximum reasoning with automatic task delegation' },
  ultracode: { labelKey: 'ultra', label: 'Ultra', description: 'Highest effort plus standing workflow orchestration' },
};

/** Title-cases a level no table knows yet, so it does not stand out as a raw lowercase id. */
const capitalizeLevel = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/**
 * Labels and descriptions for effort levels, identical across providers. Used
 * by EffortStepSlider and by ComposerModelMenu's trigger "· effort" suffix.
 */
export function useEffortDisplay() {
  const { t } = useTranslation('chat');
  const getLabel = useCallback((value: string) => {
    const display = EFFORT_DISPLAY[value];
    return display ? t(`composer.effortLevels.${display.labelKey}`, { defaultValue: display.label }) : capitalizeLevel(value);
  }, [t]);
  const getDescription = useCallback((option: ProviderEffortOption | undefined) => {
    if (!option) {
      return undefined;
    }
    const display = EFFORT_DISPLAY[option.value];
    return display
      ? t(`composer.effortDescriptions.${option.value}`, { defaultValue: display.description })
      : option.description;
  }, [t]);
  return { getLabel, getDescription };
}
