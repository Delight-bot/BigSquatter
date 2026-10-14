"""Ask the coach from the terminal.

    coach --day 12 --target 70 --reps 45 --depth 78 --streak 0 --missed-yesterday
"""

from __future__ import annotations

import argparse
import sys

from openai import APIError

from .service import build_coach
from .workout import Session, WorkoutSummary, describe


def main() -> None:
    p = argparse.ArgumentParser(description="Get squat coaching for a workout.")
    p.add_argument("--day", type=int, required=True)
    p.add_argument("--target", type=int, help="today's goal; omit on a rest day")
    p.add_argument("--reps", type=int, default=0, help="reps done today")
    p.add_argument("--depth", type=int, help="average depth %% of today's reps")
    p.add_argument("--streak", type=int, default=0)
    p.add_argument("--longest", type=int, default=0)
    p.add_argument("--missed-yesterday", action="store_true")
    p.add_argument("--question", help="free-text question for the coach")
    p.add_argument("--show-sources", action="store_true")
    p.add_argument("--embeddings", choices=["hf", "nim"], help="retrieval model: local Hugging Face or NVIDIA-hosted")
    args = p.parse_args()

    sessions = [Session(reps=args.reps, average_depth_percent=args.depth, duration_seconds=0)] if args.depth is not None else []
    workout = WorkoutSummary(
        day=args.day,
        target=args.target,
        reps_today=args.reps,
        current_streak=args.streak,
        longest_streak=max(args.longest, args.streak),
        missed_yesterday=args.missed_yesterday,
        sessions_today=sessions,
        question=args.question,
    )

    try:
        result = build_coach(embeddings=args.embeddings).advise(workout)
    except (APIError, RuntimeError) as e:
        sys.exit(f"Coach unavailable: {e}")
    if args.show_sources:
        print(f"Workout: {describe(workout)}\n")
        for h in result.sources:
            print(f"  {h.score:.3f}  {h.chunk.source} - {h.chunk.heading}")
        print()
    print(result.text)


if __name__ == "__main__":
    main()
