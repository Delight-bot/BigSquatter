/**
 * The 30-day progression.
 *
 * Held as an explicit table rather than a formula: the curve has deliberate
 * deload weeks and a taper before the day-30 finale, which no tidy one-liner
 * reproduces, and a table is trivially verifiable against the spec.
 */

export const CHALLENGE_LENGTH = 30;

/** `null` marks a rest day. */
const TARGETS: readonly (number | null)[] = [
  // Week 1 — build the habit.
  20, 25, 30, 35, 40, 45, null,
  // Week 2 — volume climbs.
  45, 50, 55, 60, 65, 70, null,
  // Week 3 — deload, then push past week 2.
  60, 65, 70, 75, 80, 85, null,
  // Week 4 — first century.
  75, 80, 85, 90, 95, 100, null,
  // Final two days — taper, then the finale.
  90, 100,
];

if (TARGETS.length !== CHALLENGE_LENGTH) {
  throw new Error(`Challenge plan must have ${CHALLENGE_LENGTH} days, got ${TARGETS.length}`);
}

export interface PlannedDay {
  /** 1-based day number. */
  day: number;
  /** Reps required. 0 on a rest day. */
  target: number;
  isRest: boolean;
}

export function isValidDay(day: number): boolean {
  return Number.isInteger(day) && day >= 1 && day <= CHALLENGE_LENGTH;
}

export function getPlannedDay(day: number): PlannedDay {
  if (!isValidDay(day)) throw new RangeError(`Day must be 1-${CHALLENGE_LENGTH}, got ${day}`);
  const target = TARGETS[day - 1];
  return { day, target: target ?? 0, isRest: target === null };
}

export const CHALLENGE_PLAN: readonly PlannedDay[] = TARGETS.map((_, i) => getPlannedDay(i + 1));

/** Total reps across the whole challenge, used for the overall progress bar. */
export const TOTAL_PLANNED_REPS = CHALLENGE_PLAN.reduce((sum, d) => sum + d.target, 0);

/**
 * Days that actually require reps. This — not {@link CHALLENGE_LENGTH} — is the
 * denominator for "days completed", otherwise rest days make 100% unreachable.
 */
export const ACTIVE_DAY_COUNT = CHALLENGE_PLAN.filter((d) => !d.isRest).length;
