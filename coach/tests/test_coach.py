import os

import pytest
from fastapi.testclient import TestClient

from coach.api import create_app
from coach.coach import SYSTEM_PROMPT, Coach
from coach.llm import strip_reasoning
from coach.workout import Session, WorkoutSummary, describe


def test_every_knowledge_section_becomes_a_chunk(chunks):
    assert len(chunks) >= 10
    assert all(c.text and c.heading for c in chunks)
    assert {c.source for c in chunks} >= {"squat-depth.md", "pain-and-safety.md"}


@pytest.mark.parametrize(
    ("query", "expected_source"),
    [
        ("my reps are shallow and stop short of parallel depth", "squat-depth.md"),
        ("I missed a day and broke my streak", "recovery-and-streaks.md"),
        ("sharp pain in my knee joint", "pain-and-safety.md"),
        ("how should I split the daily goal into sets", "sets-and-pacing.md"),
    ],
)
def test_retrieval_finds_the_relevant_document(retriever, query, expected_source):
    assert retriever.search(query, k=1)[0].chunk.source == expected_source


def test_describe_flags_shallow_reps_and_missed_target():
    facts = describe(
        WorkoutSummary(
            day=12,
            target=70,
            reps_today=45,
            missed_yesterday=True,
            sessions_today=[Session(reps=25, average_depth_percent=80, duration_seconds=60),
                            Session(reps=20, average_depth_percent=86, duration_seconds=55)],
        )
    )
    assert "45 of 70" in facts and "25 to go" in facts
    assert "Average depth 83% (shallow" in facts
    assert "streak was broken" in facts


def test_describe_rest_day():
    assert "rest day" in describe(WorkoutSummary(day=7))


def test_strip_reasoning():
    assert strip_reasoning("<think>they did 45</think>\nGreat work today.") == "Great work today."
    assert strip_reasoning("Partial answer <think>cut off") == "Partial answer"


def test_coach_sends_retrieved_guidance_to_the_model(retriever):
    seen = {}

    def fake_chat(system, user):
        seen["system"], seen["user"] = system, user
        return "Slow down and sit deeper."

    advice = Coach(retriever, fake_chat).advise(
        WorkoutSummary(day=3, target=30, reps_today=30,
                       sessions_today=[Session(reps=30, average_depth_percent=70, duration_seconds=90)])
    )
    assert advice.text == "Slow down and sit deeper."
    assert seen["system"] == SYSTEM_PROMPT
    assert "[1]" in seen["user"] and "Day 3 of 30" in seen["user"]
    assert any(h.chunk.source == "squat-depth.md" for h in advice.sources)


def test_question_is_retrieved_even_when_workout_facts_dominate(retriever):
    workout = WorkoutSummary(
        day=12, target=70, reps_today=45, current_streak=8, missed_yesterday=True,
        sessions_today=[Session(reps=45, average_depth_percent=78, duration_seconds=120)],
        question="sharp pain in my knee joint",
    )
    advice = Coach(retriever, lambda s, u: "").advise(workout)
    assert advice.sources[0].chunk.source == "pain-and-safety.md"
    assert len(advice.sources) == 3


def test_api_round_trip(retriever):
    app = create_app(Coach(retriever, lambda s, u: "Nice work."))
    with TestClient(app) as client:
        assert client.get("/health").json() == {"status": "ok"}
        r = client.post("/coach", json={"day": 5, "target": 40, "reps_today": 40})
        assert r.status_code == 200
        assert r.json()["advice"] == "Nice work."
        assert len(r.json()["sources"]) == 3

        assert client.post("/coach", json={"day": 31}).status_code == 422


def test_env_file_fills_missing_vars_but_never_overrides(tmp_path, monkeypatch):
    from coach.llm import load_env_file

    env = tmp_path / ".env"
    env.write_text("# comment\nNIM_MODEL='from-file'\nNVIDIA_API_KEY=nvapi-file\n", encoding="utf-8")
    monkeypatch.delenv("NIM_MODEL", raising=False)
    monkeypatch.setenv("NVIDIA_API_KEY", "nvapi-real-env")
    load_env_file(env)
    try:
        assert os.environ["NIM_MODEL"] == "from-file"
        assert os.environ["NVIDIA_API_KEY"] == "nvapi-real-env"
    finally:
        os.environ.pop("NIM_MODEL", None)
