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
from pathlib import Path

from openai import OpenAI

HOSTED_BASE_URL = "https://integrate.api.nvidia.com/v1"
DEFAULT_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b"

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


ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


def load_env_file(path: Path = ENV_FILE) -> None:
    """Read KEY=value lines from coach/.env (gitignored) into the environment.

    Real environment variables win, so a deployment can override the file.
    """
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        key, sep, value = line.partition("=")
        if sep and not key.strip().startswith("#"):
            os.environ.setdefault(key.strip(), value.strip().strip("'\""))


@dataclass(frozen=True)
class NimConfig:
    base_url: str
    model: str
    api_key: str | None
    # Nemotron reasons before answering by default. A short coaching tip doesn't
    # need it, and with it on the reasoning alone used up a 1024-token budget.
    thinking: bool = False

    @classmethod
    def from_env(cls) -> NimConfig:
        load_env_file()
        return cls(
            base_url=os.environ.get("NIM_BASE_URL", HOSTED_BASE_URL),
            model=os.environ.get("NIM_MODEL", DEFAULT_MODEL),
            api_key=os.environ.get("NVIDIA_API_KEY"),
            thinking=os.environ.get("NIM_THINKING", "0") == "1",
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
            max_tokens=4096 if config.thinking else 512,
            extra_body={"chat_template_kwargs": {"enable_thinking": config.thinking}},
        )
        choice = response.choices[0]
        text = strip_reasoning(choice.message.content or "")
        if not text:
            raise RuntimeError(f"{config.model} returned no answer (finish_reason={choice.finish_reason})")
        return text

    return chat
