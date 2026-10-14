"""The workout numbers the app sends, and how they're turned into words.

The app never sends video or pose data. These fields mirror what it already
stores: the challenge day, today's progress, the streak and recent sessions.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

CHALLENGE_LENGTH = 30
# Average depth below this (as % of the ~parallel target) gets flagged as shallow.
SHALLOW_DEPTH_PERCENT = 90


class Session(BaseModel):
    reps: int = Field(ge=0)
    average_depth_percent: int = Field(ge=0, le=100)
    duration_seconds: int = Field(ge=0)


class WorkoutSummary(BaseModel):
    day: int = Field(ge=1, le=CHALLENGE_LENGTH)
    target: int | None = Field(default=None, ge=0, description="Today's goal; null on a rest day")
    reps_today: int = Field(default=0, ge=0)
    current_streak: int = Field(default=0, ge=0)
    longest_streak: int = Field(default=0, ge=0)
    missed_yesterday: bool = False
    sessions_today: list[Session] = Field(default_factory=list)
    question: str | None = Field(default=None, max_length=500, description="Optional free-text question")


def describe(w: WorkoutSummary) -> str:
    """Plain-English facts about the workout. Used as the retrieval query and in the prompt."""
    lines = [f"Day {w.day} of {CHALLENGE_LENGTH}."]

    if w.target is None:
        lines.append("Today is a rest day.")
    elif w.reps_today >= w.target:
        lines.append(f"Hit today's goal: {w.reps_today} of {w.target} squats.")
    else:
        lines.append(f"Short of today's goal: {w.reps_today} of {w.target} squats, {w.target - w.reps_today} to go.")

    if w.sessions_today:
        sets = ", ".join(str(s.reps) for s in w.sessions_today)
        lines.append(f"Did {len(w.sessions_today)} set(s) today: {sets} reps.")
        counted = [s for s in w.sessions_today if s.reps > 0]
        if counted:
            depth = round(sum(s.average_depth_percent * s.reps for s in counted) / sum(s.reps for s in counted))
            quality = "shallow reps, not reaching parallel" if depth < SHALLOW_DEPTH_PERCENT else "good depth"
            lines.append(f"Average depth {depth}% ({quality}).")

    if w.missed_yesterday:
        lines.append("Missed yesterday, so the streak was broken.")
    lines.append(f"Current streak {w.current_streak} days, longest {max(w.longest_streak, w.current_streak)}.")

    if w.question:
        lines.append(f"The user asks: {w.question.strip()}")
    return " ".join(lines)
