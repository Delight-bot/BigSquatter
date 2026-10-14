"""HTTP API: `uvicorn coach.api:app`."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .coach import Coach
from .llm import NimConfig, nim_chat
from .retriever import BGE_QUERY_PREFIX, Retriever, hf_embedder, load_chunks
from .workout import WorkoutSummary

KNOWLEDGE_DIR = Path(__file__).resolve().parents[2] / "knowledge"


class SourceOut(BaseModel):
    source: str
    heading: str
    score: float


class AdviceOut(BaseModel):
    advice: str
    sources: list[SourceOut]


def build_coach() -> Coach:
    retriever = Retriever(load_chunks(KNOWLEDGE_DIR), hf_embedder(), query_prefix=BGE_QUERY_PREFIX)
    return Coach(retriever, nim_chat(NimConfig.from_env()))


def create_app(coach: Coach | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Embedding the knowledge base takes a few seconds, so do it once at startup.
        app.state.coach = coach or build_coach()
        yield

    app = FastAPI(title="BigSquatter Coach", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["POST"], allow_headers=["*"])

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/coach", response_model=AdviceOut)
    def advise(workout: WorkoutSummary, request: Request) -> AdviceOut:
        result = request.app.state.coach.advise(workout)
        return AdviceOut(
            advice=result.text,
            sources=[SourceOut(source=h.chunk.source, heading=h.chunk.heading, score=round(h.score, 3)) for h in result.sources],
        )

    return app


app = create_app()
