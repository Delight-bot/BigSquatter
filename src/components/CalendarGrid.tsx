/**
 * The 30 challenge days laid out as a calendar, aligned so day 1 falls on its
 * real weekday — a plain 6×5 block would make the streak read wrongly against
 * the week the user actually lived.
 */

import { CHALLENGE_PLAN } from '../challenge/plan';
import { currentDay, getDayProgress, type Challenge } from '../challenge/engine';
import { mondayFirstWeekday, type DateKey } from '../utils/date';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

interface CalendarGridProps {
  challenge: Challenge;
  today: DateKey;
}

export function CalendarGrid({ challenge, today }: CalendarGridProps) {
  const day = currentDay(challenge, today);
  const leadingBlanks = mondayFirstWeekday(challenge.startDate);

  return (
    <>
      <div className="calendar" aria-hidden="true">
        {WEEKDAYS.map((d, i) => (
          <span key={`${d}-${i}`} className="calendar__head">
            {d}
          </span>
        ))}
      </div>
      <div className="calendar" style={{ marginTop: 6 }} role="list">
        {Array.from({ length: leadingBlanks }, (_, i) => (
          <span key={`blank-${i}`} aria-hidden="true" />
        ))}
        {CHALLENGE_PLAN.map((planned) => {
          const progress = getDayProgress(challenge, planned.day);
          const isToday = planned.day === day;
          const isFuture = planned.day > day;
          const missed = !isFuture && !isToday && !progress.completed;

          const classes = ['day'];
          if (planned.isRest) classes.push('day--rest');
          else if (progress.completed) classes.push('day--done');
          else if (missed) classes.push('day--missed');
          if (isFuture) classes.push('day--future');
          if (isToday) classes.push('day--today');

          const mark = planned.isRest ? 'R' : progress.completed ? '✓' : missed ? '×' : '○';

          return (
            <span
              key={planned.day}
              role="listitem"
              className={classes.join(' ')}
              title={describe(planned.day, planned.isRest, planned.target, progress.completedReps)}
            >
              <span className="day__n">{planned.day}</span>
              <span className="day__mark">{mark}</span>
            </span>
          );
        })}
      </div>
      <div className="legend">
        <span>✓ complete</span>
        <span>○ open</span>
        <span>× missed</span>
        <span>R rest</span>
      </div>
    </>
  );
}

function describe(day: number, isRest: boolean, target: number, done: number): string {
  if (isRest) return `Day ${day} — rest day`;
  return `Day ${day} — ${done}/${target} squats`;
}
