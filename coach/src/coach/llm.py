"""Chat completions against NVIDIA NIM.

NIM speaks the OpenAI API, so the same client works against NVIDIA's hosted
catalogue (build.nvidia.com) and a self-hosted NIM container on a GPU box. Only
the base URL changes.
"""

from __future__ import annotations

import os
import re
from collections.abc import Callable
from dataclasses import dataclass

from openai import OpenAI

HOSTED_BASE_URL = "https://integrate.api.nvidia.com/v1"
DEFAULT_MODEL = "nvidia/nemotron-nano-3-30b-a3b"

# (system prompt, user prompt) -> reply
ChatFn = Callable[[str, str], str]

_THINK = re.compile(r"<think>.*?</think>", re.DOTALL)


def strip_reasoning(text: str) -> str:
    """Nemotron can emit its reasoning in <think> tags; users only see the answer."""
    text = _THINK.sub("", text)
    # An unterminated block means the reply was cut off mid-thought.
    if "<think>" in text:
        text = text.split("<think>", 1)[0]
    return text.strip()


@dataclass(frozen=True)
class NimConfig:
    base_url: str
    model: str
    api_key: str | None

    @classmethod
    def from_env(cls) -> NimConfig:
        return cls(
            base_url=os.environ.get("NIM_BASE_URL", HOSTED_BASE_URL),
            model=os.environ.get("NIM_MODEL", DEFAULT_MODEL),
            api_key=os.environ.get("NVIDIA_API_KEY"),
        )


def nim_chat(config: NimConfig) -> ChatFn:
    if config.base_url == HOSTED_BASE_URL and not config.api_key:
        raise RuntimeError("Set NVIDIA_API_KEY (get one at https://build.nvidia.com), or point NIM_BASE_URL at a local NIM")

    # A local NIM container doesn't check the key, but the client requires one.
    client = OpenAI(base_url=config.base_url, api_key=config.api_key or "not-needed")

    def chat(system: str, user: str) -> str:
        response = client.chat.completions.create(
            model=config.model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.3,
            max_tokens=1024,
        )
        return strip_reasoning(response.choices[0].message.content or "")

    return chat
