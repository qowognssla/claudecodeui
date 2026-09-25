import { useId, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Dumbbell } from 'lucide-react';

import type { ProviderEffortOption } from '@/shared/types';
import { cn } from '@/shared/utils';
import { useEffortDisplay } from '@/modules/chat/hooks/useEffortLabels';

type EffortStepSliderProps = {
  effort: string;
  /** Includes the leading `default` sentinel. */
  options: ProviderEffortOption[];
  onSelectEffort: (effort: string) => void;
};

/** Knob diameter in px; stops are inset by half of it so the knob sits flush at both ends. */
const KNOB_SIZE = 20;

/**
 * "Effort (High)" with its description, stacked over a full-width stepped
 * slider: one dot per level and a knob on the chosen one. Tapping a dot,
 * dragging the knob, or the arrow keys pick a level; a drag commits once on
 * release so the session is not updated for every stop it passes. The menu
 * stays open afterwards.
 *
 * Used by chat's ComposerModelMenu for every provider, so Claude and Codex
 * present their effort levels the same way.
 */
export function EffortStepSlider({ effort, options, onSelectEffort }: EffortStepSliderProps) {
  const { t } = useTranslation('chat');
  const { getLabel, getDescription } = useEffortDisplay();
  const descriptionId = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  // Index the knob previews while a pointer drag is in progress; null when idle (which also re-enables
  // the knob's slide transition). Kept apart from `effort` so a drag commits once, on release.
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === effort));
  const activeIndex = dragIndex ?? selectedIndex;
  const activeOption = options[activeIndex];
  const lastIndex = options.length - 1;

  const commitIndex = (index: number) => {
    if (index !== selectedIndex) {
      onSelectEffort(options[index].value);
    }
  };

  const stopLeft = (index: number) => (
    lastIndex > 0
      ? `calc(${KNOB_SIZE / 2}px + (100% - ${KNOB_SIZE}px) * ${index / lastIndex})`
      : '50%'
  );

  // Snaps the pointer to the nearest stop, using the same inset geometry as `stopLeft`.
  const indexFromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= KNOB_SIZE || lastIndex === 0) {
      return activeIndex;
    }
    const ratio = (clientX - rect.left - KNOB_SIZE / 2) / (rect.width - KNOB_SIZE);
    return Math.round(Math.min(Math.max(ratio, 0), 1) * lastIndex);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragIndex(indexFromClientX(event.clientX));
  };
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragIndex !== null) {
      setDragIndex(indexFromClientX(event.clientX));
    }
  };
  const handlePointerUp = () => {
    if (dragIndex !== null) {
      commitIndex(dragIndex);
      setDragIndex(null);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') nextIndex = Math.min(selectedIndex + 1, lastIndex);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') nextIndex = Math.max(selectedIndex - 1, 0);
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = lastIndex;
    if (nextIndex === null) {
      return;
    }
    event.preventDefault();
    commitIndex(nextIndex);
  };

  const effortTitle = t('composer.effort', { defaultValue: 'Effort' });
  const activeLabel = getLabel(activeOption?.value ?? effort);
  const description = getDescription(activeOption);

  return (
    <div className="w-80 max-w-full px-2.5 pb-3 pt-2">
      <div className="flex items-start gap-2.5">
        <Dumbbell className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-5 text-foreground">
            {effortTitle} <span className="text-muted-foreground">({activeLabel})</span>
          </p>
          {description && (
            <p id={descriptionId} className="mt-0.5 break-keep text-xs leading-4 text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
      <div
        role="slider"
        tabIndex={0}
        aria-label={effortTitle}
        aria-describedby={description ? descriptionId : undefined}
        aria-valuemin={0}
        aria-valuemax={lastIndex}
        aria-valuenow={activeIndex}
        aria-valuetext={activeLabel}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => setDragIndex(null)}
        className="mt-2.5 cursor-pointer touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
      >
        {/* The color sits on this inner element, not the slider: touch browsers keep :hover after a
            tap, and index.css resets the background of a hovered .cursor-pointer on touch devices. */}
        <div className="rounded-full bg-primary p-[3px] shadow-inner">
          <div ref={trackRef} className="relative" style={{ height: KNOB_SIZE }}>
            {options.map((option, index) => (
              <span
                key={option.value}
                aria-hidden
                className="absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/60"
                style={{ left: stopLeft(index) }}
              />
            ))}
            <span
              aria-hidden
              className={cn(
                'absolute top-0 -translate-x-1/2 rounded-full bg-white shadow-md ring-1 ring-black/10',
                dragIndex === null && 'transition-[left] duration-200 ease-out motion-reduce:transition-none',
              )}
              style={{ left: stopLeft(activeIndex), width: KNOB_SIZE, height: KNOB_SIZE }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
