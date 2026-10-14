/**
 * Daily reminders.
 *
 * Honest scope: a web app without a push server can only remind the user while
 * a tab of it is alive, so this schedules an in-page timer for the chosen time
 * and additionally nudges on app open if the day's target is still unmet. That
 * covers the realistic case (phone-in-pocket PWA left open) without pretending
 * to deliver server push.
 */

export type ReminderPermission = 'unsupported' | 'default' | 'granted' | 'denied';

export function permissionState(): ReminderPermission {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as ReminderPermission;
}

export async function requestPermission(): Promise<ReminderPermission> {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission as ReminderPermission;
  return (await Notification.requestPermission()) as ReminderPermission;
}

export function notify(title: string, body: string): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, icon: `${import.meta.env.BASE_URL}icon-192.png`, tag: 'squat-daily' });
  } catch {
    // Some browsers only allow notifications from a service worker; failing
    // quietly is better than breaking the page for a reminder.
  }
}

/** Milliseconds until the next occurrence of `HH:MM` in local time. */
export function msUntil(time: string, now: Date = new Date()): number {
  const [h, m] = time.split(':').map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) throw new Error(`Bad time: ${time}`);
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export interface ReminderContext {
  day: number;
  target: number;
  remaining: number;
  streak: number;
}

export function reminderCopy({ day, target, remaining, streak }: ReminderContext): {
  title: string;
  body: string;
} {
  const title = streak > 0 ? `🔥 Don't break your ${streak} day streak` : '🏋🏾 Day ' + day + ' is waiting';
  return {
    title,
    body: `Day ${day} · ${remaining} of ${target} squats left.`,
  };
}

/**
 * Arms a one-shot timer for the next reminder. Returns a cancel function.
 *
 * `getContext` is called at fire time, not schedule time, so the copy reflects
 * whatever the user has actually done by then — and returning null (target
 * already met) skips the notification entirely.
 */
export function scheduleReminder(
  time: string,
  getContext: () => ReminderContext | null,
): () => void {
  const delay = msUntil(time);
  // setTimeout is clamped to ~24.8 days; a reminder is always under that.
  const id = window.setTimeout(() => {
    const context = getContext();
    if (context && context.remaining > 0) {
      const { title, body } = reminderCopy(context);
      notify(title, body);
    }
  }, delay);
  return () => window.clearTimeout(id);
}
