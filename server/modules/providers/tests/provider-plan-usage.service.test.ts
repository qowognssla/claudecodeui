import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeClaudePlanUsage,
  normalizeCodexPlanUsage,
} from '@/modules/providers/services/provider-plan-usage.service.js';

test('Claude reports utilization as a percentage, not a fraction', () => {
  assert.deepEqual(normalizeClaudePlanUsage({
    five_hour: { utilization: 27.0, resets_at: '2030-01-01T05:00:00.000Z' },
    seven_day: { utilization: 62, resets_at: '2030-01-07T00:00:00.000Z' },
  }), {
    primary: { used_percent: 27, window_minutes: 300, resets_at: 1_893_474_000 },
    secondary: { used_percent: 62, window_minutes: 10_080, resets_at: 1_893_974_400 },
  });
});

test('a fresh Claude window without a reset time still counts as a window', () => {
  assert.deepEqual(normalizeClaudePlanUsage({
    five_hour: { utilization: 0, resets_at: null },
    seven_day: null,
  }), {
    primary: { used_percent: 0, window_minutes: 300 },
  });
});

test('Claude model-scoped weekly windows ride along as scoped windows', () => {
  assert.deepEqual(normalizeClaudePlanUsage({
    five_hour: { utilization: 11, resets_at: '2030-01-01T05:00:00.000Z' },
    seven_day: { utilization: 12, resets_at: '2030-01-07T00:00:00.000Z' },
    limits: [
      { kind: 'session', group: 'session', percent: 11, resets_at: '2030-01-01T05:00:00.000Z', scope: null },
      { kind: 'weekly_all', group: 'weekly', percent: 12, resets_at: '2030-01-07T00:00:00.000Z', scope: null },
      {
        kind: 'weekly_scoped',
        group: 'weekly',
        percent: 3,
        resets_at: '2030-01-07T00:00:00.000Z',
        scope: { model: { id: null, display_name: 'Fable' }, surface: null },
      },
    ],
  }), {
    primary: { used_percent: 11, window_minutes: 300, resets_at: 1_893_474_000 },
    secondary: { used_percent: 12, window_minutes: 10_080, resets_at: 1_893_974_400 },
    scoped: [{ used_percent: 3, window_minutes: 10_080, resets_at: 1_893_974_400, scope: 'Fable' }],
  });
});

test('missing Claude plan data stays unavailable', () => {
  assert.equal(normalizeClaudePlanUsage({ five_hour: null, seven_day: null }), null);
  assert.equal(normalizeClaudePlanUsage({ five_hour: { utilization: 140 } }), null);
});

test('Codex account rate limits map onto the same window shape', () => {
  assert.deepEqual(normalizeCodexPlanUsage({
    ordinaryUsageAllowed: true,
    rateLimits: {
      primary: { usedPercent: 37, windowDurationMins: 300, resetsAt: 1_790_312_990 },
      secondary: { usedPercent: 53, windowDurationMins: 10_080, resetsAt: 1_790_646_280 },
    },
  }), {
    primary: { used_percent: 37, window_minutes: 300, resets_at: 1_790_312_990 },
    secondary: { used_percent: 53, window_minutes: 10_080, resets_at: 1_790_646_280 },
  });
  assert.equal(normalizeCodexPlanUsage({ rateLimits: null }), null);
});
