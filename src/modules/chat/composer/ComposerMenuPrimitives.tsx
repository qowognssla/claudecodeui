import type { ReactNode, Ref } from 'react';
import { Check, ChevronRight } from 'lucide-react';

import { cn } from '@/shared/utils';
import type { ComposerMenuAnchor } from '@/shared/types';

/**
 * Building blocks of the composer's settings popover (effort, model and
 * permission mode) so its sections share one surface and one row style.
 *
 * Used by chat's ComposerModelMenu.
 */
export function ComposerMenuSurface({
  anchor,
  menuRef,
  ariaLabel,
  children,
}: {
  anchor: ComposerMenuAnchor;
  menuRef: Ref<HTMLDivElement>;
  ariaLabel: string;
  children: ReactNode;
}) {
  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      className="fixed z-[100] min-w-48 overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl"
      style={{
        right: anchor.right,
        bottom: anchor.bottom,
        maxHeight: anchor.maxHeight,
        maxWidth: anchor.maxWidth,
      }}
    >
      {children}
    </div>
  );
}

/** Used by chat's ComposerPermissionSection to caption its list of modes. */
export function ComposerMenuHeading({ children }: { children: ReactNode }) {
  return (
    <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground">{children}</p>
  );
}

/** Used by chat's ComposerModelMenu to divide its effort slider from the model and permission rows. */
export function ComposerMenuSeparator() {
  return <div className="my-1 h-px bg-border" aria-hidden />;
}

/**
 * Settings-style row: icon, title, the current value on the right and a
 * chevron that turns when the row's options are shown below it.
 *
 * Used by chat's ComposerModelMenu (model row) and ComposerPermissionSection (permission row).
 */
export function ComposerMenuDisclosure({
  icon,
  title,
  value,
  isExpanded,
  onToggle,
}: {
  icon: ReactNode;
  title: ReactNode;
  value: ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-expanded={isExpanded}
      onClick={onToggle}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
        'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
      )}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>
      <span className="shrink-0 text-foreground">{title}</span>
      <span className="ml-auto min-w-0 truncate text-right text-muted-foreground">{value}</span>
      <ChevronRight
        aria-hidden
        className={cn(
          'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',
          isExpanded && 'rotate-90',
        )}
      />
    </button>
  );
}

/** Used by chat's ComposerModelMenu and ComposerPermissionSection to hold an expanded row's options in an inset well. */
export function ComposerMenuPanel({ children }: { children: ReactNode }) {
  return <div className="mx-1 mb-1 rounded-lg bg-muted/40 p-0.5">{children}</div>;
}

/** Used by chat's ComposerModelMenu and ComposerPermissionSection to render one selectable option with its checked state. */
export function ComposerMenuItem({
  label,
  description,
  icon,
  isSelected,
  onSelect,
  role = 'menuitemradio',
  trailing,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  isSelected: boolean;
  onSelect: () => void;
  role?: 'menuitemradio' | 'menuitem';
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === 'menuitemradio' ? isSelected : undefined}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors',
        'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
        isSelected ? 'text-foreground' : 'text-foreground/90',
        className,
      )}
    >
      {icon && <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate leading-5">{label}</span>
        {description && (
          <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">{description}</span>
        )}
      </span>
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
        {trailing ?? (isSelected ? <Check className="h-3.5 w-3.5 text-foreground" /> : null)}
      </span>
    </button>
  );
}
