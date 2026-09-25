import { memo, useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Cpu } from 'lucide-react';

import type { PermissionMode, ProviderEffortOption, ProviderModelOption } from '@/shared/types';
import { DEFAULT_EFFORT_VALUE } from '@/shared/constants';
import { useComposerMenuAnchor } from '@/modules/chat/hooks/useComposerMenuAnchor';
import { useEffortDisplay } from '@/modules/chat/hooks/useEffortLabels';
import {
  ComposerMenuDisclosure,
  ComposerMenuItem,
  ComposerMenuPanel,
  ComposerMenuSeparator,
  ComposerMenuSurface,
} from '@/modules/chat/composer/ComposerMenuPrimitives';
import { ComposerPermissionSection, PermissionModeIcon } from '@/modules/chat/composer/ComposerPermissionSection';
import { EffortStepSlider } from '@/modules/chat/composer/EffortStepSlider';

/** The expandable row currently showing its options; one at a time keeps the popover short on phones. */
type ExpandedRow = 'model' | 'permission' | null;

type ComposerModelMenuProps = {
  effort: string;
  /** Effort values the active provider/model actually accepts; empty hides the section. */
  effortOptions: ProviderEffortOption[];
  onSelectEffort: (effort: string) => void;
  model: string;
  /** Model catalog for the active provider; empty hides the section. */
  modelOptions: ProviderModelOption[];
  onSelectModel: (model: string) => void;
  modelsLoading: boolean;
  permissionMode: PermissionMode;
  /** Modes the active provider supports, in the order the backend reports them; empty hides the section. */
  permissionModes: PermissionMode[];
  onSelectPermissionMode: (mode: PermissionMode) => void;
  providerLabel: string;
};

/**
 * Rendered by chat's ChatComposer as the one popover for the next turn's
 * settings, laid out the same for every provider: the effort slider on top,
 * then the model and the permission mode as expandable rows. The trigger shows
 * the permission mode's icon, the model and the effort.
 */
function ComposerModelMenu({
  effort,
  effortOptions,
  onSelectEffort,
  model,
  modelOptions,
  onSelectModel,
  modelsLoading,
  permissionMode,
  permissionModes,
  onSelectPermissionMode,
  providerLabel,
}: ComposerModelMenuProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const [expandedRow, setExpandedRow] = useState<ExpandedRow>(null);
  const close = useCallback(() => setIsOpen(false), []);
  // Wide enough for the permission descriptions; phones still get `maxWidth` from the anchor.
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen, close, 22 * 16);

  const { getLabel: getEffortLabel } = useEffortDisplay();
  // The first slider stop leaves the effort to the provider's configured default.
  const sliderOptions = useMemo<ProviderEffortOption[]>(
    () => (effortOptions.length > 0 ? [{ value: DEFAULT_EFFORT_VALUE }, ...effortOptions] : []),
    [effortOptions],
  );
  const effortLabel = getEffortLabel(effort);

  const selectedModelOption = useMemo(
    () => modelOptions.find((option) => option.value === model) ?? null,
    [model, modelOptions],
  );
  const modelLabel = selectedModelOption?.label || model;

  const hasEffortSection = effortOptions.length > 0;
  const hasModelSection = modelOptions.length > 0 || modelsLoading;
  const hasPermissionSection = permissionModes.length > 0;
  if (!hasEffortSection && !hasModelSection && !hasPermissionSection) {
    return null;
  }

  const toggleRow = (row: Exclude<ExpandedRow, null>) => {
    setExpandedRow((current) => (current === row ? null : row));
  };

  // With neither a model nor an effort to name, the trigger is just the permission icon.
  const triggerLabel = hasModelSection ? modelLabel : hasEffortSection ? effortLabel : null;
  const ariaLabel = t('composer.modelMenu', {
    defaultValue: 'Select model, effort and permissions',
  });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          updateAnchor();
          // Every open starts with both lists collapsed.
          setExpandedRow(null);
          setIsOpen((current) => !current);
        }}
        className="flex h-8 max-w-32 shrink-0 items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted sm:max-w-64"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        {hasPermissionSection && <PermissionModeIcon mode={permissionMode} className="h-3.5 w-3.5 shrink-0" />}
        {triggerLabel && <span className="truncate">{triggerLabel}</span>}
        {hasModelSection && hasEffortSection && effort !== DEFAULT_EFFORT_VALUE && (
          <span className="hidden shrink-0 text-muted-foreground sm:inline">· {effortLabel}</span>
        )}
      </button>

      {isOpen && anchor && createPortal(
        <ComposerMenuSurface anchor={anchor} menuRef={menuRef} ariaLabel={ariaLabel}>
          {hasEffortSection && (
            <EffortStepSlider effort={effort} options={sliderOptions} onSelectEffort={onSelectEffort} />
          )}
          {hasEffortSection && (hasModelSection || hasPermissionSection) && <ComposerMenuSeparator />}

          {hasModelSection && (
            <>
              <ComposerMenuDisclosure
                icon={<Cpu className="h-4 w-4" />}
                title={t('composer.model', { defaultValue: 'Model' })}
                value={modelLabel}
                isExpanded={expandedRow === 'model'}
                onToggle={() => toggleRow('model')}
              />
              {expandedRow === 'model' && (
                <ComposerMenuPanel>
                  {modelOptions.length === 0 && modelsLoading && (
                    <p className="px-2.5 py-1.5 text-sm text-muted-foreground">
                      {t('composer.loadingModels', { defaultValue: 'Loading models…' })}
                    </p>
                  )}
                  {modelOptions.map((option) => (
                    <ComposerMenuItem
                      key={option.value}
                      label={option.label || option.value}
                      description={option.description}
                      isSelected={option.value === model}
                      onSelect={() => {
                        onSelectModel(option.value);
                        setIsOpen(false);
                      }}
                    />
                  ))}
                </ComposerMenuPanel>
              )}
            </>
          )}

          {hasPermissionSection && (
            <ComposerPermissionSection
              permissionMode={permissionMode}
              permissionModes={permissionModes}
              providerLabel={providerLabel}
              isExpanded={expandedRow === 'permission'}
              onToggle={() => toggleRow('permission')}
              onSelectPermissionMode={(mode) => {
                onSelectPermissionMode(mode);
                setIsOpen(false);
              }}
            />
          )}
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  );
}

/** Memoized: the composer re-renders on every keystroke and none of this menu's props change while typing. */
export default memo(ComposerModelMenu);
