"""Retrieval over the Markdown knowledge base.

Each `## ` section of a file becomes one chunk. Chunks are embedded once at
startup and searched by cosine similarity. With a handful of documents a NumPy
matrix is all the vector store we need, and it keeps the moving parts visible.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np

# Maps a batch of texts to an (n, dim) array of embeddings.
Embedder = Callable[[Sequence[str]], np.ndarray]

DEFAULT_EMBED_MODEL = "BAAI/bge-small-en-v1.5"
# bge models retrieve better when queries (not passages) carry this instruction.
BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


@dataclass(frozen=True)
class Chunk:
    source: str
    heading: str
    text: str

    @property
    def passage(self) -> str:
        return f"{self.heading}\n{self.text}"


@dataclass(frozen=True)
class Hit:
    chunk: Chunk
    score: float


def load_chunks(directory: Path) -> list[Chunk]:
    chunks: list[Chunk] = []
    for path in sorted(directory.glob("*.md")):
        title = path.stem
        heading: str | None = None
        lines: list[str] = []

        def flush() -> None:
            body = "\n".join(lines).strip()
            if heading and body:
                chunks.append(Chunk(path.name, f"{title}: {heading}", body))

        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("# "):
                title = line[2:].strip()
            elif line.startswith("## "):
                flush()
                heading, lines = line[3:].strip(), []
            else:
                lines.append(line)
        flush()
    return chunks


def _normalise(vectors: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    return vectors / np.where(norms == 0, 1, norms)


class Retriever:
    def __init__(self, chunks: Sequence[Chunk], embed: Embedder, query_prefix: str = "") -> None:
        if not chunks:
            raise ValueError("Knowledge base is empty")
        self._chunks = list(chunks)
        self._embed = embed
        self._query_prefix = query_prefix
        self._matrix = _normalise(np.asarray(embed([c.passage for c in self._chunks]), dtype=np.float32))

    def search(self, query: str, k: int = 3) -> list[Hit]:
        q = _normalise(np.asarray(self._embed([self._query_prefix + query]), dtype=np.float32))[0]
        scores = self._matrix @ q
        top = np.argsort(-scores)[:k]
        return [Hit(self._chunks[i], float(scores[i])) for i in top]


def hf_embedder(model_name: str = DEFAULT_EMBED_MODEL) -> Embedder:
    """A Hugging Face sentence-transformers model, downloaded on first use."""
    from sentence_transformers import SentenceTransformer  # heavy import, so deferred

    model = SentenceTransformer(model_name)
    return lambda texts: model.encode(list(texts), normalize_embeddings=True)
