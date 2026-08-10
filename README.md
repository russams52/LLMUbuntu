# LLMUbuntu

A minimal, self-contained chat service built with [FastAPI](https://fastapi.tiangolo.com/).
It ships a small web UI and a pluggable assistant. The default assistant backend is fully
local and deterministic, so the app runs end to end with **no API keys or network access**.

## Requirements

- Python 3.10+ (developed on Python 3.12 / Ubuntu 24.04)

## Setup

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements-dev.txt   # use requirements.txt for runtime only
```

## Run the app

```bash
. .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Then open http://localhost:8000 and chat. Try `help`, `reverse hello`, or
`count one two three`.

## API

| Method | Path            | Description                              |
| ------ | --------------- | ---------------------------------------- |
| GET    | `/api/health`   | Health check + message count             |
| GET    | `/api/messages` | Full in-memory conversation history      |
| POST   | `/api/chat`     | `{"message": "..."}` → user + assistant  |

```bash
curl -s localhost:8000/api/chat -H 'Content-Type: application/json' \
  -d '{"message": "reverse hello"}'
```

## Lint & test

```bash
. .venv/bin/activate
ruff check .
pytest
```

## Extending with a real LLM

`app/assistant.py` is the extension point. Replace or subclass `LocalAssistant.reply`
to call a real provider (e.g. read a key from the environment and issue an HTTP request),
while keeping the local backend as an offline fallback.

## Cloud Agent environment

`.cursor/environment.json` configures the Cursor Cloud Agent environment: `install`
creates a virtualenv and installs dependencies, and a `web` terminal runs the
auto-reloading dev server on port 8000.
