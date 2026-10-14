"""Wires a Coach together from configuration. Shared by the CLI, the FastAPI app
and the Lambda handler, and free of web-framework imports so Lambda stays small."""

from __future__ import annotations

import os
from pathlib import Path

from .coach import Coach
from .llm import NimConfig, nim_chat, nim_embedder
from .retriever import BGE_QUERY_PREFIX, Retriever, load_chunks

KNOWLEDGE_DIR = Path(__file__).resolve().parent / "knowledge"


def build_coach(config: NimConfig | None = None, embeddings: str | None = None) -> Coach:
    """`embeddings` is "hf" (local Hugging Face model, needs PyTorch) or "nim"
    (NVIDIA-hosted, just an HTTP call). Defaults to $COACH_EMBEDDINGS, else "hf"."""
    config = config or NimConfig.from_env()
    embeddings = embeddings or os.environ.get("COACH_EMBEDDINGS", "hf")
    chunks = load_chunks(KNOWLEDGE_DIR)

    if embeddings == "nim":
        retriever = Retriever(
            chunks,
            nim_embedder(config, "passage"),
            embed_query=nim_embedder(config, "query"),
        )
    elif embeddings == "hf":
        from .retriever import hf_embedder  # imports PyTorch, so only when asked

        retriever = Retriever(chunks, hf_embedder(), query_prefix=BGE_QUERY_PREFIX)
    else:
        raise ValueError(f"COACH_EMBEDDINGS must be 'hf' or 'nim', got {embeddings!r}")

    return Coach(retriever, nim_chat(config))
