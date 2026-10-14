"""The RAG step: describe the workout, retrieve guidance, ask the model."""

from __future__ import annotations

from dataclasses import dataclass

from .llm import ChatFn
from .retriever import Hit, Retriever
from .workout import WorkoutSummary, describe

SYSTEM_PROMPT = """You are the coach in a 30-day squat challenge app.
Write 2 to 4 short sentences of encouraging, specific advice for today.
Base advice only on the numbered guidance provided, and refer to the user's actual numbers.
Do not diagnose injuries. If the user mentions pain, tell them to stop and see a professional if it persists.
Do not mention the guidance, sources or numbers in brackets. Speak directly to the user."""


@dataclass(frozen=True)
class Advice:
    text: str
    sources: list[Hit]


def build_prompt(facts: str, hits: list[Hit]) -> str:
    guidance = "\n\n".join(f"[{i}] {h.chunk.passage}" for i, h in enumerate(hits, 1))
    return f"Guidance:\n{guidance}\n\nToday's workout:\n{facts}"


class Coach:
    def __init__(self, retriever: Retriever, chat: ChatFn, k: int = 3) -> None:
        self._retriever = retriever
        self._chat = chat
        self._k = k

    def advise(self, workout: WorkoutSummary) -> Advice:
        facts = describe(workout)
        hits = self._retrieve(workout, facts)
        return Advice(self._chat(SYSTEM_PROMPT, build_prompt(facts, hits)), hits)

    def _retrieve(self, workout: WorkoutSummary, facts: str) -> list[Hit]:
        # The workout numbers dominate a combined query, so a one-line question like
        # "my knee hurts" gets drowned out. Search for the question on its own first.
        hits = self._retriever.search(workout.question, k=2) if workout.question else []
        for hit in self._retriever.search(facts, k=self._k):
            if all(hit.chunk != h.chunk for h in hits):
                hits.append(hit)
        return hits[: self._k]
