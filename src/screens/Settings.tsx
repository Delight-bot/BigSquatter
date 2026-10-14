import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Switch } from '../components/Switch';
import { useChallengeStore } from '../store/challengeStore';
import { permissionState, requestPermission, type ReminderPermission } from '../services/notifications';
import { isConfigured as supabaseConfigured } from '../services/supabase';
import { DEFAULT_SQUAT_CONFIG } from '../cv/squatDetector';

export function Settings() {
  const navigate = useNavigate();
  const { settings, updateSettings, name, resetChallenge } = useChallengeStore();
  // Read once on mount; it only changes in response to the prompt below.
  const [permission, setPermission] = useState<ReminderPermission>(permissionState);
  const [confirmReset, setConfirmReset] = useState(false);

  const toggleReminder = async (on: boolean) => {
    if (!on) {
      updateSettings({ reminderTime: null });
      return;
    }
    const result = await requestPermission();
    setPermission(result);
    if (result === 'granted') updateSettings({ reminderTime: '18:00' });
  };

  return (
    <div className="screen stack--lg">
      <div>
        <p className="eyebrow">Settings</p>
        <h1 style={{ fontSize: '1.6rem' }}>{name || 'Your setup'}</h1>
      </div>

      <div className="card">
        <h2 style={{ fontSize: '1rem', marginBottom: 4 }}>Camera</h2>
        <Switch
          label="Front camera"
          hint="Off uses the rear camera, which is usually sharper."
          checked={settings.cameraFacing === 'user'}
          onChange={(on) => updateSettings({ cameraFacing: on ? 'user' : 'environment' })}
        />
        <Switch
          label="Mirror the preview"
          hint="Front camera only. Matches what you'd see in a mirror."
          checked={settings.mirrorPreview}
          onChange={(mirrorPreview) => updateSettings({ mirrorPreview })}
        />
        <Switch
          label="Show skeleton overlay"
          hint="Draws the detected joints over the video."
          checked={settings.showSkeleton}
          onChange={(showSkeleton) => updateSettings({ showSkeleton })}
        />
        <Switch
          label="Rep sounds"
          hint="A blip per rep, a fanfare when you hit the target."
          checked={settings.soundOn}
          onChange={(soundOn) => updateSettings({ soundOn })}
        />
      </div>

      <div className="card">
        <h2 style={{ fontSize: '1rem', marginBottom: 4 }}>Daily reminder</h2>
        <Switch
          label="Remind me"
          hint={
            permission === 'denied'
              ? 'Notifications are blocked in your browser settings.'
              : permission === 'unsupported'
                ? 'This browser has no notification support.'
                : 'Fires while the app is open in a tab.'
          }
          checked={settings.reminderTime !== null}
          onChange={(on) => void toggleReminder(on)}
        />
        {settings.reminderTime !== null && (
          <label className="field" style={{ marginTop: 14 }}>
            <span className="field__label">Time</span>
            <input
              type="time"
              value={settings.reminderTime}
              onChange={(e) => updateSettings({ reminderTime: e.target.value })}
            />
          </label>
        )}
      </div>

      <div className="card">
        <h2 style={{ fontSize: '1rem', marginBottom: 10 }}>How counting works</h2>
        <p className="muted" style={{ fontSize: '0.85rem', lineHeight: 1.6, margin: 0 }}>
          A pose model finds 33 body landmarks in each camera frame. The app measures your knee
          angle from hip → knee → ankle and counts a rep only when that angle travels from standing
          (≥{DEFAULT_SQUAT_CONFIG.standingAngle}°) down past depth (≤{DEFAULT_SQUAT_CONFIG.depthAngle}
          °) and back up. Frames where your whole body isn't visible are ignored rather than guessed
          at.
        </p>
      </div>

      <div className="card">
        <h2 style={{ fontSize: '1rem', marginBottom: 10 }}>Privacy</h2>
        <p className="muted" style={{ fontSize: '0.85rem', lineHeight: 1.6, margin: 0 }}>
          The model and its runtime are served from this app and run in your browser. Camera frames
          are analysed in memory and never recorded, saved or uploaded. Your progress lives in this
          device's local storage
          {supabaseConfigured() ? ' and syncs to your account when signed in.' : '.'}
        </p>
      </div>

      <div className="card">
        <h2 style={{ fontSize: '1rem', marginBottom: 10 }}>Danger zone</h2>
        {confirmReset ? (
          <div className="stack">
            <p style={{ margin: 0, fontSize: '0.875rem' }}>
              This erases your challenge, streak and every logged session on this device. It can't be
              undone.
            </p>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setConfirmReset(false)}
              >
                Keep my progress
              </button>
              <button
                type="button"
                className="btn btn--danger btn--sm"
                onClick={() => {
                  resetChallenge();
                  navigate('/onboarding', { replace: true });
                }}
              >
                Erase everything
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn--danger btn--sm"
            onClick={() => setConfirmReset(true)}
          >
            Reset challenge
          </button>
        )}
      </div>
    </div>
  );
}
