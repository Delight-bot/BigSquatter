/**
 * Single source of truth, persisted to localStorage.
 *
 * The store holds only serialisable data and delegates every rule to the pure
 * functions in `challenge/` — so the interesting logic stays testable without a
 * React tree, and the store is little more than plumbing.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  createChallenge,
  createId,
  currentDay,
  recordReps,
  type Challenge,
} from '../challenge/engine';
import { todayKey } from '../utils/date';

export interface WorkoutSession {
  id: string;
  /** Challenge day this set counted toward. */
  day: number;
  startedAt: string;
  endedAt: string;
  reps: number;
  durationMs: number;
  /** Mean depth of counted reps, 0..100. */
  averageDepthPercent: number;
  source: 'camera' | 'manual';
}

export interface Settings {
  /** `HH:MM` local reminder time, or null when reminders are off. */
  reminderTime: string | null;
  cameraFacing: 'user' | 'environment';
  /** Mirrors the preview, which is what users expect from a front camera. */
  mirrorPreview: boolean;
  showSkeleton: boolean;
  soundOn: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  reminderTime: null,
  cameraFacing: 'user',
  mirrorPreview: true,
  showSkeleton: true,
  soundOn: true,
};

interface ChallengeStoreState {
  challenge: Challenge | null;
  sessions: WorkoutSession[];
  settings: Settings;
  name: string;
  onboarded: boolean;

  startChallenge: (name?: string) => void;
  /** Adds reps to today and returns whether that completed the day. */
  addReps: (reps: number) => boolean;
  logSession: (session: Omit<WorkoutSession, 'id' | 'day'>) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  resetChallenge: () => void;
}

export const STORAGE_KEY = 'squat-challenge/v1';

export const useChallengeStore = create<ChallengeStoreState>()(
  persist(
    (set, get) => ({
      challenge: null,
      sessions: [],
      settings: DEFAULT_SETTINGS,
      name: '',
      onboarded: false,

      startChallenge: (name) =>
        set({
          challenge: createChallenge(todayKey()),
          sessions: [],
          name: name?.trim() || get().name,
          onboarded: true,
        }),

      addReps: (reps) => {
        const { challenge } = get();
        if (!challenge || reps <= 0) return false;
        const day = currentDay(challenge);
        const result = recordReps(challenge, day, reps);
        set({ challenge: result.challenge });
        return result.justCompleted;
      },

      logSession: (session) => {
        const { challenge, sessions } = get();
        if (!challenge) return;
        const entry: WorkoutSession = {
          ...session,
          id: createId(),
          day: currentDay(challenge),
        };
        // Newest first, and capped so localStorage can't grow without bound.
        set({ sessions: [entry, ...sessions].slice(0, 200) });
      },

      updateSettings: (patch) => set({ settings: { ...get().settings, ...patch } }),

      resetChallenge: () => set({ challenge: null, sessions: [], onboarded: false }),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      partialize: (state) => ({
        challenge: state.challenge,
        sessions: state.sessions,
        settings: state.settings,
        name: state.name,
        onboarded: state.onboarded,
      }),
      merge: (persisted, current) => {
        // Settings gain fields between releases; spread over the defaults so an
        // older saved payload can't leave a new setting undefined.
        const saved = (persisted ?? {}) as Partial<ChallengeStoreState>;
        return {
          ...current,
          ...saved,
          settings: { ...DEFAULT_SETTINGS, ...(saved.settings ?? {}) },
        };
      },
    },
  ),
);
