import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Bot,
  ClipboardList,
  Hand,
  ShieldQuestion,
  Smile,
  type LucideIcon,
} from 'lucide-react';

import type { PermissionMode } from '@/shared/types';
import { cn } from '@/shared/utils';
import {
  ComposerMenuDisclosure,
  ComposerMenuHeading,
  ComposerMenuItem,
  ComposerMenuPanel,
} from '@/modules/chat/composer/ComposerMenuPrimitives';

type ModeAppearance = {
  icon: LucideIcon;
  /** Icon color; the risky modes stand out wherever the icon is shown, including the menu trigger. */
  tone: string;
};

/**
 * Presentation only. Which modes exist for a provider comes from the backend
 * capability matrix, so an unknown mode still renders through UNKNOWN_MODE.
 */
const MODE_APPEARANCE: Record<PermissionMode, ModeAppearance> = {
  default: { icon: Hand, tone: 'text-muted-foreground' },
  auto: { icon: Bot, tone: 'text-blue-600 dark:text-blue-400' },
  acceptEdits: { icon: Smile, tone: 'text-green-600 dark:text-green-400' },
  bypassPermissions: { icon: AlertTriangle, tone: 'text-orange-600 dark:text-orange-400' },
  plan: { icon: ClipboardList, tone: 'text-primary' },
};

const UNKNOWN_MODE: ModeAppearance = { icon: ShieldQuestion, tone: 'text-muted-foreground' };

const getAppearance = (mode: PermissionMode | string): ModeAppearance =>
  MODE_APPEARANCE[mode as PermissionMode] ?? UNKNOWN_MODE;

/** Used by chat's ComposerModelMenu trigger and by ComposerPermissionSection to show a mode at a glance. */
export function PermissionModeIcon({ mode, className }: { mode: PermissionMode; className?: string }) {
  const appearance = getAppearance(mode);
  const Icon = appearance.icon;
  return <Icon aria-hidden className={cn('h-4 w-4', appearance.tone, className)} />;
}

type ComposerPermissionSectionProps = {
  permissionMode: PermissionMode;
  /** Modes the active provider supports, in the order the backend reports them. */
  permissionModes: PermissionMode[];
  /** Names the provider in the list caption ("How should Codex actions be approved?"). */
  providerLabel: string;
  isExpanded: boolean;
  onToggle: () => void;
  onSelectPermissionMode: (mode: PermissionMode) => void;
};

/**
 * The permission row of the composer's settings popover: shows the active
 * mode and expands into every mode the provider supports, each with its
 * description.
 *
 * Used by chat's ComposerModelMenu, below the model row, for every provider.
 */
export function ComposerPermissionSection({
  permissionMode,
  permissionModes,
  providerLabel,
  isExpanded,
  onToggle,
  onSelectPermissionMode,
}: ComposerPermissionSectionProps) {
  const { t } = useTranslation('chat');
  const getModeLabel = (mode: PermissionMode) => t(`codex.modes.${mode}`, { defaultValue: mode });

  return (
    <>
      <ComposerMenuDisclosure
        icon={<PermissionModeIcon mode={permissionMode} />}
        title={t('composer.permission', { defaultValue: 'Permissions' })}
        value={getModeLabel(permissionMode)}
        isExpanded={isExpanded}
        onToggle={onToggle}
      />
      {isExpanded && (
        <ComposerMenuPanel>
          <ComposerMenuHeading>
            {t('composer.permissionHeading', {
              provider: providerLabel,
              defaultValue: 'How should {{provider}} actions be approved?',
            })}
          </ComposerMenuHeading>
          {permissionModes.map((mode) => (
            <ComposerMenuItem
              key={mode}
              icon={<PermissionModeIcon mode={mode} />}
              label={getModeLabel(mode)}
              description={t(`codex.descriptions.${mode}`, { defaultValue: '' }) || undefined}
              isSelected={mode === permissionMode}
              onSelect={() => onSelectPermissionMode(mode)}
            />
          ))}
        </ComposerMenuPanel>
      )}
    </>
  );
}
