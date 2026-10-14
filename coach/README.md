# Coach: RAG with Hugging Face and NVIDIA Nemotron

After a workout, the app sends its numbers (day, reps against target, rep depth, streak, and optionally a question) and gets back two to four sentences of coaching grounded in a small exercise-guidance knowledge base.

```
$ coach --day 12 --target 70 --reps 45 --depth 78 --longest 10 --missed-yesterday --show-sources
Workout: Day 12 of 30. Short of today's goal: 45 of 70 squats, 25 to go. Did 1 set(s) today: 45 reps.
Average depth 78% (shallow reps, not reaching parallel). Missed yesterday, so the streak was broken.
Current streak 0 days, longest 10.

  0.810  sets-and-pacing.md - Sets and pacing: Splitting the daily goal
  0.787  recovery-and-streaks.md - Recovery, rest days and streaks: Missed days and broken streaks
  0.757  squat-depth.md - Squat depth: What counts as a full rep

You've got 25 squats left—keep the momentum going. Since your depth is at 78%, focus on driving your
knees down to reach parallel on each rep; that extra range will make every count. You've already broken
the streak yesterday, so resist the urge to rush; stick to the planned sets with rest to stay fresh for
the next 18 days.
```

That's real output from `nemotron-3.5-lightning-30b-a3b`. The same request over HTTP is `POST /coach` with a JSON body of the same fields; the response is `{"advice": "...", "sources": [...]}`.

## How it works

```mermaid
flowchart LR
  W["Workout numbers<br/>(no video)"] --> D["describe()<br/>numbers → plain English"]
  D --> R["Retriever<br/>bge-small embeddings<br/>cosine top-k"]
  Q["Optional question"] --> R
  K[("knowledge/*.md<br/>chunked by ## section")] --> R
  R --> P["Prompt<br/>guidance + facts"]
  D --> P
  P --> N["NVIDIA NIM<br/>Nemotron 3.5 Lightning"]
  N --> A["Advice + sources"]
```

1. **Describe.** `workout.py` turns the numbers into sentences ("Short of today's goal: 45 of 70… Average depth 78%, shallow reps"). Embedding models and LLMs handle text better than raw JSON, and the same sentences serve as both the search query and the prompt.
2. **Retrieve.** Each `##` section of `knowledge/*.md` is one chunk, embedded once at startup with [`BAAI/bge-small-en-v1.5`](https://huggingface.co/BAAI/bge-small-en-v1.5) through Hugging Face `sentence-transformers`. Search is a dot product over a NumPy matrix. With a dozen chunks a vector database would add a service without adding anything useful.
3. **Generate.** The top three chunks and the facts go to **Nemotron 3.5 Lightning** (`nvidia/nemotron-3.5-lightning-30b-a3b`, a mixture-of-experts model with 30B parameters, about 3B active per token) through NVIDIA NIM. Swap in the larger Nemotron 3 Super with `NIM_MODEL`. Any `<think>` reasoning in the reply is stripped before it's returned.

### Design notes

- **Question-first retrieval.** In the first version, "my knee hurts" plus the workout numbers was searched as one query, and the numbers drowned out the question, so the pain guidance wasn't retrieved. Now the question is searched on its own first and the results are merged (`Coach._retrieve`, covered by a regression test).
- **One client for hosted and self-hosted.** NIM exposes the OpenAI API, so moving from NVIDIA's hosted endpoint to a NIM container on your own GPU only changes `NIM_BASE_URL`.
- **Reasoning off by default.** Nemotron reasons before it answers. On the first live run, the reasoning alone used up the whole 1024-token budget and the advice came back empty. A 2–4 sentence tip doesn't need it, and with reasoning off a reply takes about 55 tokens. An empty reply now raises an error instead of returning silently.
- **Privacy.** Only aggregate numbers leave the phone. Pose detection stays on-device.
- **Safety.** The pain guidance tells the user to stop and see a professional, and the system prompt forbids diagnosis.

## Run it

Needs Python 3.11+. These steps use WSL Ubuntu and [uv](https://docs.astral.sh/uv/).

```bash
cd coach
uv venv ~/.venvs/bigsquatter-coach && source ~/.venvs/bigsquatter-coach/bin/activate
uv pip install torch --index-url https://download.pytorch.org/whl/cpu   # CPU is plenty for embeddings
uv pip install -e ".[dev]"

pytest                                     # no API key or model download needed

cp .env.example .env                       # then put your free key from https://build.nvidia.com in .env
coach --day 12 --target 70 --reps 45 --depth 78 --missed-yesterday --show-sources
coach --day 9 --target 50 --reps 50 --question "my left knee hurts when I go down"

uvicorn coach.api:app --port 8000          # HTTP API; docs at http://localhost:8000/docs
```

| Variable | Default | |
| --- | --- | --- |
| `NVIDIA_API_KEY` | none | Required for the hosted endpoint |
| `NIM_BASE_URL` | `https://integrate.api.nvidia.com/v1` | Set to e.g. `http://localhost:8000/v1` for a self-hosted NIM container |
| `NIM_MODEL` | `nvidia/nemotron-3.5-lightning-30b-a3b` | Any chat model in the NIM catalogue |
| `NIM_THINKING` | `0` | `1` lets the model reason before answering |

## Tests

`tests/` replaces the Hugging Face model with a hashed bag-of-words embedder and the LLM with a stub, so the suite runs in a couple of seconds offline. It covers chunking, retrieval relevance per document, the workout description, reasoning stripping, question-first retrieval and the HTTP API.
