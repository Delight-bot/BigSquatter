"""AWS Lambda entry point: API Gateway HTTP API → `handler`.

Runs with NVIDIA-hosted embeddings ("nim"), so the deployment package is just
NumPy, the OpenAI client and Pydantic. No PyTorch. The NVIDIA key lives in SSM
Parameter Store as a SecureString and is read once per cold start.
"""

from __future__ import annotations

import base64
import json
import logging
import os

from openai import APIError
from pydantic import ValidationError

from .coach import Coach
from .llm import NimConfig
from .service import build_coach
from .workout import WorkoutSummary

log = logging.getLogger()
log.setLevel(logging.INFO)

_coach: Coach | None = None


def _get_coach() -> Coach:
    global _coach
    if _coach is None:
        import boto3  # provided by the Lambda runtime

        param = os.environ["NVIDIA_API_KEY_PARAM"]
        key = boto3.client("ssm").get_parameter(Name=param, WithDecryption=True)["Parameter"]["Value"]
        base = NimConfig.from_env()
        config = NimConfig(base_url=base.base_url, model=base.model, api_key=key, thinking=base.thinking)
        _coach = build_coach(config, embeddings="nim")
    return _coach


def _response(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json", "cache-control": "no-store"},
        "body": json.dumps(body),
    }


def handler(event: dict, context: object) -> dict:
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8")

    try:
        workout = WorkoutSummary.model_validate_json(raw)
    except ValidationError as e:
        return _response(400, {"error": "invalid workout", "details": e.errors(include_url=False, include_context=False)})

    try:
        result = _get_coach().advise(workout)
    except (APIError, RuntimeError):
        log.exception("Coach failed")
        return _response(502, {"error": "coach unavailable"})

    return _response(200, {
        "advice": result.text,
        "sources": [{"source": h.chunk.source, "heading": h.chunk.heading, "score": round(h.score, 3)} for h in result.sources],
    })
