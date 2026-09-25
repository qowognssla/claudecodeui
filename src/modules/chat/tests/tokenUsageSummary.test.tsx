import { expect, test } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

import '@/modules/i18n';
import TokenUsageSummary from '@/modules/chat/composer/TokenUsageSummary';

// The button's title carries every figure the composer knows; the visible
// text keeps only what fits the narrow composer row.
const renderButton = (usage: Record<string, unknown>) => {
  render(<TokenUsageSummary usage={usage} />);
  const button = screen.getByRole('button');
  return { title: button.getAttribute('title') ?? '', text: button.textContent ?? '' };
};

test('remaining context uses the latest turn rather than cumulative session tokens', () => {
  const { title } = renderButton({ used: 300_000, contextUsed: 40_000, total: 200_000 });

  expect(title).toMatch(/40K used · 160K left/);
});

test('does not claim a remaining balance when the current context is unavailable', () => {
  const { title } = renderButton({ used: 300_000, total: 200_000 });

  expect(title).toMatch(/300K used/);
  expect(title).not.toMatch(/left/);
});

test('shows the five-hour plan balance ahead of the session context balance', () => {
  const { title, text } = renderButton({
    used: 40_000,
    contextUsed: 40_000,
    total: 200_000,
    rateLimits: {
      primary: { used_percent: 25, window_minutes: 300, resets_at: 2_000_000_000 },
      secondary: { used_percent: 60, window_minutes: 10_080, resets_at: 2_000_000_000 },
    },
  });

  expect(text).toMatch(/5h 75% left/);
  expect(title).toMatch(/7d 40% left/);
  expect(title).toMatch(/160K left/);
});

test('lists model-scoped weekly windows after the account-wide ones', () => {
  const { title, text } = renderButton({
    rateLimits: {
      primary: { used_percent: 11, window_minutes: 300, resets_at: 2_000_000_000 },
      secondary: { used_percent: 12, window_minutes: 10_080, resets_at: 2_000_000_000 },
      scoped: [{ used_percent: 3, window_minutes: 10_080, resets_at: 2_000_000_000, scope: 'Fable' }],
    },
  });

  expect(title).toMatch(/5h 89% left · 7d 88% left · Fable 7d 97% left/);
  // The composer row only has room for the five-hour figure.
  expect(text).toMatch(/5h 89% left/);
  expect(text).not.toMatch(/7d/);
});

test('an expired window is a stale snapshot, not a balance', () => {
  const { title } = renderButton({
    used: 1_000,
    rateLimits: { primary: { used_percent: 90, window_minutes: 300, resets_at: 1_000 } },
  });

  expect(title).not.toMatch(/5h/);
});
