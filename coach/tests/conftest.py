import re
import zlib
import numpy as np
import pytest

from coach.retriever import Retriever, load_chunks
from coach.service import KNOWLEDGE_DIR
DIM = 512


def bag_of_words(texts):
    """Deterministic stand-in for the HF model: hashed word counts."""
    out = np.zeros((len(texts), DIM), dtype=np.float32)
    for row, text in enumerate(texts):
        for word in re.findall(r"[a-z]+", text.lower()):
            if len(word) > 3:
                out[row, zlib.crc32(word.encode()) % DIM] += 1
    return out


@pytest.fixture
def chunks():
    return load_chunks(KNOWLEDGE_DIR)


@pytest.fixture
def retriever(chunks):
    return Retriever(chunks, bag_of_words)
