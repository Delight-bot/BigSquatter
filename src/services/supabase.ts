/**
 * Optional cloud sync.
 *
 * The app is local-first: every feature works with no account and no network,
 * and Supabase is a backup/multi-device layer on top. If the env vars are
 * absent the client is never constructed and `isConfigured()` is false, so the
 * UI hides the account section rather than showing a broken login.
 *
 * Schema lives in `supabase/schema.sql`.
 */

import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { Challenge } from '../challenge/engine';
import type { WorkoutSession } from '../store/challengeStore';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;

export function isConfigured(): boolean {
  return Boolean(url && anonKey);
}

export function getClient(): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
  client ??= createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return client;
}

export async function currentSession(): Promise<Session | null> {
  if (!isConfigured()) return null;
  const { data } = await getClient().auth.getSession();
  return data.session;
}

export async function signInWithEmail(email: string): Promise<void> {
  // Magic link keeps the hackathon build password-free, which also means no
  // password handling to get wrong.
  const { error } = await getClient().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  if (!isConfigured()) return;
  await getClient().auth.signOut();
}

export interface SyncPayload {
  challenge: Challenge;
  sessions: WorkoutSession[];
}

/**
 * Pushes local state up, keyed by the signed-in user. One row per user per
 * challenge; the whole day map goes up as JSON because it is small (30 entries)
 * and this keeps the write a single idempotent upsert.
 */
export async function pushState({ challenge, sessions }: SyncPayload): Promise<void> {
  const supabase = getClient();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error('Not signed in.');

  const { error } = await supabase.from('challenges').upsert(
    {
      id: challenge.id,
      user_id: userId,
      start_date: challenge.startDate,
      days: challenge.days,
      sessions,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
  if (error) throw error;
}

/** Pulls the most recently updated challenge for the signed-in user. */
export async function pullState(): Promise<SyncPayload | null> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('challenges')
    .select('id, start_date, days, sessions')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    challenge: {
      id: data.id as string,
      startDate: data.start_date as string,
      days: (data.days ?? {}) as Challenge['days'],
    },
    sessions: (data.sessions ?? []) as WorkoutSession[],
  };
}
