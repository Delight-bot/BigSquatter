"""HTTP API: `uvicorn coach.api:app`."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .coach import Coach
from .service import build_coach
from .workout import WorkoutSummary


class SourceOut(BaseModel):
    source: str
    heading: str
    score: float


class AdviceOut(BaseModel):
    advice: str
    sources: list[SourceOut]


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

    # /api/coach matches the deployed path (CloudFront → API Gateway → Lambda),
    # so the app can be pointed at this server in development.
    @app.post("/coach", response_model=AdviceOut)
    @app.post("/api/coach", response_model=AdviceOut)
    def advise(workout: WorkoutSummary, request: Request) -> AdviceOut:
        result = request.app.state.coach.advise(workout)
        return AdviceOut(
            advice=result.text,
            sources=[SourceOut(source=h.chunk.source, heading=h.chunk.heading, score=round(h.score, 3)) for h in result.sources],
        )

    return app


app = create_app()
