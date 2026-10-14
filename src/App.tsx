/**
 * App shell: routing, the tab bar, and the one cross-cutting effect (reminders).
 *
 * Routing is hash-based on purpose — the build is a static bundle that has to
 * work from any host, including plain file/object storage with no rewrite rules.
 */

import { useEffect } from 'react';
import { HashRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { ChartIcon, GearIcon, HomeIcon } from './components/Icons';
import { getStats } from './challenge/engine';
import { computeStreak } from './challenge/streak';
import { Home } from './screens/Home';
import { Onboarding } from './screens/Onboarding';
import { Progress } from './screens/Progress';
import { Settings } from './screens/Settings';
import { Versus } from './screens/Versus';
import { Workout } from './screens/Workout';
import { scheduleReminder } from './services/notifications';
import { useChallengeStore } from './store/challengeStore';

export default function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}

function Shell() {
  const challenge = useChallengeStore((s) => s.challenge);
  const reminderTime = useChallengeStore((s) => s.settings.reminderTime);
  const location = useLocation();

  // Reminder context is read at fire time from the store, not captured here, so
  // the notification reflects progress made after it was scheduled.
  useEffect(() => {
    if (!reminderTime) return;
    return scheduleReminder(reminderTime, () => {
      const active = useChallengeStore.getState().challenge;
      if (!active) return null;
      const stats = getStats(active);
      if (stats.today.isRest) return null;
      return {
        day: stats.today.day,
        target: stats.today.target,
        remaining: Math.max(0, stats.today.target - stats.today.completedReps),
        streak: computeStreak(active).current,
      };
    });
  }, [reminderTime]);

  const showTabs =
    !location.pathname.startsWith('/workout') &&
    !location.pathname.startsWith('/versus') &&
    location.pathname !== '/onboarding';

  return (
    <div className="shell">
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route
          path="/"
          element={challenge ? <Home challenge={challenge} /> : <Navigate to="/onboarding" replace />}
        />
        <Route
          path="/workout"
          element={
            challenge ? <Workout challenge={challenge} /> : <Navigate to="/onboarding" replace />
          }
        />
        <Route
          path="/progress"
          element={
            challenge ? <Progress challenge={challenge} /> : <Navigate to="/onboarding" replace />
          }
        />
        <Route path="/settings" element={<Settings />} />
        {/* No challenge required: a friend can join from an invite link on a fresh install. */}
        <Route path="/versus" element={<Versus />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {showTabs && (
        <nav className="tabbar" aria-label="Main">
          <NavLink to="/" end>
            <HomeIcon />
            Today
          </NavLink>
          <NavLink to="/progress">
            <ChartIcon />
            Progress
          </NavLink>
          <NavLink to="/settings">
            <GearIcon />
            Settings
          </NavLink>
        </nav>
      )}
    </div>
  );
}
