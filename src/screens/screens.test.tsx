/**
 * @vitest-environment jsdom
 *
 * Smoke tests for the screens.
 *
 * These are not pixel assertions — the CV and challenge rules are covered by
 * their own unit tests. What these catch is the class of failure unit tests
 * can't: a screen that throws on render, a store wiring mistake, or a day's
 * numbers rendering as `NaN`/`undefined` for a real user.
 *
 * The Workout screen is excluded on purpose: it needs getUserMedia and WebGL,
 * so a jsdom render would only test the mocks.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Home } from './Home';
import { Onboarding } from './Onboarding';
import { Progress } from './Progress';
import { Settings } from './Settings';
import { Versus } from './Versus';
import { createChallenge, recordReps, type Challenge } from '../challenge/engine';
import { getPlannedDay } from '../challenge/plan';
import { todayKey } from '../utils/date';
import { DEFAULT_SETTINGS, useChallengeStore } from '../store/challengeStore';

/** A challenge that started today, so day 1 is "today" whenever this runs. */
function challengeStartingToday(): Challenge {
  return createChallenge(todayKey(), 'render-test');
}

function mount(ui: React.ReactElement, path = '/') {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
}

beforeEach(() => {
  useChallengeStore.setState({
    challenge: challengeStartingToday(),
    sessions: [],
    settings: { ...DEFAULT_SETTINGS },
    name: 'Ada',
    onboarded: true,
  });
});

afterEach(() => {
  // Vitest runs without `globals`, so testing-library's auto-cleanup is not
  // registered; without this, each render stacks up in the same document.
  cleanup();
  window.localStorage.clear();
});

describe('Onboarding', () => {
  it('previews the plan and offers a start button', () => {
    mount(<Onboarding />);
    expect(screen.getByRole('button', { name: /start day 1/i })).toBeTruthy();
    expect(screen.getByText(/20 squats/)).toBeTruthy();
    expect(screen.getByText(/100 squats/)).toBeTruthy();
  });
});

describe('Home', () => {
  it("shows today's day number, target and streak", () => {
    const challenge = challengeStartingToday();
    mount(<Home challenge={challenge} />);
    expect(screen.getByText(/day 1 \/ 30/i)).toBeTruthy();
    expect(screen.getByText(String(getPlannedDay(1).target))).toBeTruthy();
    expect(screen.getByText(/let's go, ada/i)).toBeTruthy();
  });

  it('reports how many reps are left', () => {
    const challenge = recordReps(challengeStartingToday(), 1, 8).challenge;
    mount(<Home challenge={challenge} />);
    expect(screen.getByText(/12 to go/i)).toBeTruthy();
  });

  it('switches its message once the day is complete', () => {
    const challenge = recordReps(challengeStartingToday(), 1, 20).challenge;
    mount(<Home challenge={challenge} />);
    expect(screen.getByText(/day complete/i)).toBeTruthy();
    expect(screen.queryByText(/to go/i)).toBeNull();
  });

  it('renders a real percentage, never NaN', () => {
    mount(<Home challenge={challengeStartingToday()} />);
    const bars = screen.getAllByRole('progressbar');
    for (const bar of bars) {
      const value = Number(bar.getAttribute('aria-valuenow'));
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('offers a manual fallback for logging squats', () => {
    mount(<Home challenge={challengeStartingToday()} />);
    expect(screen.getByRole('button', { name: /without the camera/i })).toBeTruthy();
  });
});

describe('Progress', () => {
  it('renders all 30 challenge days', () => {
    mount(<Progress challenge={challengeStartingToday()} />);
    const days = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(days).toHaveLength(30);
  });

  it('explains the empty session list rather than showing nothing', () => {
    mount(<Progress challenge={challengeStartingToday()} />);
    expect(screen.getByText(/no sessions yet/i)).toBeTruthy();
  });

  it('lists a logged session with its stats', () => {
    useChallengeStore.setState({
      sessions: [
        {
          id: 's1',
          day: 1,
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          reps: 20,
          durationMs: 90_000,
          averageDepthPercent: 92,
          source: 'camera',
        },
      ],
    });
    mount(<Progress challenge={challengeStartingToday()} />);
    expect(screen.getByText(/1:30/)).toBeTruthy();
    expect(screen.getByText(/92% depth/)).toBeTruthy();
  });
});

describe('Settings', () => {
  it('renders every toggle in its stored state', () => {
    mount(<Settings />);
    const switches = screen.getAllByRole('switch');
    expect(switches.length).toBeGreaterThanOrEqual(5);
    expect(screen.getByRole('switch', { name: /skeleton/i }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('requires a confirmation before erasing progress', () => {
    mount(<Settings />);
    expect(screen.queryByRole('button', { name: /erase everything/i })).toBeNull();
    expect(screen.getByRole('button', { name: /reset challenge/i })).toBeTruthy();
  });
});

describe('Versus', () => {
  it('prefills the name and offers both ways in', () => {
    mount(<Versus />);
    expect((screen.getByLabelText(/your name/i) as HTMLInputElement).value).toBe('Ada');
    expect(screen.getByRole('button', { name: /create match/i })).toBeTruthy();
    // No code typed yet, so joining is not possible.
    expect(screen.getByRole('button', { name: /^join$/i }).hasAttribute('disabled')).toBe(true);
  });

  it('prefills the code from an invite link', () => {
    mount(<Versus />, '/versus?join=abcde');
    expect((screen.getByLabelText(/match code/i) as HTMLInputElement).value).toBe('ABCDE');
    expect(screen.getByRole('button', { name: /^join$/i }).hasAttribute('disabled')).toBe(false);
  });
});
