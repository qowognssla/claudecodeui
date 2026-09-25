import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import '@/modules/i18n';
import { EffortStepSlider } from '@/modules/chat/composer/EffortStepSlider';

test('the slider commits supported levels with the keyboard', () => {
  const onSelectEffort = vi.fn();
  render(
    <EffortStepSlider
      effort="high"
      options={[{ value: 'default' }, { value: 'low' }, { value: 'high' }, { value: 'max' }]}
      onSelectEffort={onSelectEffort}
    />,
  );

  const slider = screen.getByRole('slider', { name: 'Effort' });
  expect(slider.getAttribute('aria-valuenow')).toBe('2');
  expect(slider.getAttribute('aria-valuemax')).toBe('3');

  fireEvent.keyDown(slider, { key: 'ArrowRight' });
  expect(onSelectEffort).toHaveBeenCalledWith('max');
  fireEvent.keyDown(slider, { key: 'Home' });
  expect(onSelectEffort).toHaveBeenCalledWith('default');
});

test('Codex and Claude levels read the same, whatever descriptions the CLI sends', () => {
  const { unmount } = render(
    <EffortStepSlider
      effort="high"
      // Codex's model cache ships its own English description per level.
      options={[{ value: 'default' }, { value: 'high', description: 'Codex CLI wording for high' }]}
      onSelectEffort={vi.fn()}
    />,
  );
  expect(screen.getByText('Greater reasoning depth for complex problems')).toBeTruthy();
  expect(screen.queryByText('Codex CLI wording for high')).toBeNull();
  unmount();

  render(
    <EffortStepSlider
      effort="high"
      options={[{ value: 'default' }, { value: 'high' }]}
      onSelectEffort={vi.fn()}
    />,
  );
  expect(screen.getByText('Greater reasoning depth for complex problems')).toBeTruthy();
});

test("Codex's ultra and Claude's ultracode share the Ultra name but keep their own description", () => {
  const { unmount } = render(
    <EffortStepSlider effort="ultra" options={[{ value: 'default' }, { value: 'ultra' }]} onSelectEffort={vi.fn()} />,
  );
  expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('Ultra');
  expect(screen.getByText('Maximum reasoning with automatic task delegation')).toBeTruthy();
  unmount();

  render(
    <EffortStepSlider effort="ultracode" options={[{ value: 'default' }, { value: 'ultracode' }]} onSelectEffort={vi.fn()} />,
  );
  expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('Ultra');
  expect(screen.getByText('Highest effort plus standing workflow orchestration')).toBeTruthy();
});

test('the default stop explains it defers to the CLI, and unknown levels fall back to the CLI wording', () => {
  const { unmount } = render(
    <EffortStepSlider effort="default" options={[{ value: 'default' }, { value: 'medium' }]} onSelectEffort={vi.fn()} />,
  );
  expect(screen.getByText("Use the CLI setting or the model's recommended effort")).toBeTruthy();
  expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('Default');
  unmount();

  render(
    <EffortStepSlider
      effort="turbo"
      options={[{ value: 'default' }, { value: 'turbo', description: 'A level no table knows yet' }]}
      onSelectEffort={vi.fn()}
    />,
  );
  expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('Turbo');
  expect(screen.getByText('A level no table knows yet')).toBeTruthy();
});
