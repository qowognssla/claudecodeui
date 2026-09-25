import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import '@/modules/i18n';
import ComposerModelMenu from '@/modules/chat/composer/ComposerModelMenu';
import type { PermissionMode } from '@/shared/types';

const renderMenu = (overrides: Partial<ComponentProps<typeof ComposerModelMenu>> = {}) => {
  const props = {
    effort: 'high',
    effortOptions: [{ value: 'low' }, { value: 'high' }, { value: 'max' }],
    onSelectEffort: vi.fn(),
    model: 'gpt-5.6-sol',
    modelOptions: [
      { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
      { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
    ],
    onSelectModel: vi.fn(),
    modelsLoading: false,
    permissionMode: 'bypassPermissions' as PermissionMode,
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions'] as PermissionMode[],
    onSelectPermissionMode: vi.fn(),
    providerLabel: 'Codex',
    ...overrides,
  };
  render(<ComposerModelMenu {...props} />);
  return props;
};

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Select model, effort and permissions' }));

test('one popover holds the effort slider, then the model and permission rows', () => {
  renderMenu();
  openMenu();

  expect(screen.getByRole('slider', { name: 'Effort' })).toBeTruthy();
  expect(screen.getByRole('menuitem', { name: /Model.*GPT-5\.6 Sol/ })).toBeTruthy();
  expect(screen.getByRole('menuitem', { name: /Permissions.*Bypass Permissions/ })).toBeTruthy();
  // Both option lists start collapsed.
  expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0);
});

test('the model and permission rows expand one at a time', () => {
  renderMenu();
  openMenu();

  fireEvent.click(screen.getByRole('menuitem', { name: /Permissions/ }));
  expect(screen.getByText('How should Codex actions be approved?')).toBeTruthy();
  expect(screen.getByRole('menuitemradio', { name: /Bypass Permissions/ }).getAttribute('aria-checked')).toBe('true');
  expect(screen.queryByRole('menuitemradio', { name: /GPT-5\.6 Luna/ })).toBeNull();

  fireEvent.click(screen.getByRole('menuitem', { name: /Model/ }));
  expect(screen.getByRole('menuitemradio', { name: /GPT-5\.6 Luna/ })).toBeTruthy();
  expect(screen.queryByText('How should Codex actions be approved?')).toBeNull();
});

test('picking a permission mode applies it and closes the popover', () => {
  const props = renderMenu();
  openMenu();

  fireEvent.click(screen.getByRole('menuitem', { name: /Permissions/ }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: /Accept Edits/ }));

  expect(props.onSelectPermissionMode).toHaveBeenCalledWith('acceptEdits');
  expect(screen.queryByRole('slider')).toBeNull();
});

test('a provider without effort levels still gets the model and permission rows', () => {
  renderMenu({ effortOptions: [] });
  openMenu();

  expect(screen.queryByRole('slider')).toBeNull();
  expect(screen.getByRole('menuitem', { name: /Model/ })).toBeTruthy();
  expect(screen.getByRole('menuitem', { name: /Permissions/ })).toBeTruthy();
});
