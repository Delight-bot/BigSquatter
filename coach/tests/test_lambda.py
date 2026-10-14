import base64
import json

import pytest

from coach import aws_lambda
from coach.coach import Coach


@pytest.fixture
def fake_coach(retriever, monkeypatch):
    coach = Coach(retriever, lambda s, u: "Keep going.")
    monkeypatch.setattr(aws_lambda, "_coach", coach)
    return coach


def call(body, b64=False):
    raw = json.dumps(body)
    event = {"body": base64.b64encode(raw.encode()).decode() if b64 else raw, "isBase64Encoded": b64}
    response = aws_lambda.handler(event, None)
    return response["statusCode"], json.loads(response["body"])


def test_returns_advice_and_sources(fake_coach):
    status, body = call({"day": 4, "target": 35, "reps_today": 20})
    assert status == 200
    assert body["advice"] == "Keep going."
    assert len(body["sources"]) == 3


def test_accepts_base64_bodies(fake_coach):
    assert call({"day": 4}, b64=True)[0] == 200


def test_rejects_invalid_workouts_with_400(fake_coach):
    status, body = call({"day": 0})
    assert status == 400
    assert body["error"] == "invalid workout"


def test_upstream_failure_is_a_502_not_a_crash(retriever, monkeypatch):
    def broken(system, user):
        raise RuntimeError("no answer")

    monkeypatch.setattr(aws_lambda, "_coach", Coach(retriever, broken))
    assert call({"day": 4}) == (502, {"error": "coach unavailable"})
