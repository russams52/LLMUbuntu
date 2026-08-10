"""FastAPI application exposing a tiny chat service and a static web UI."""

from __future__ import annotations

import itertools
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__
from .assistant import LocalAssistant

STATIC_DIR = Path(__file__).resolve().parent / "static"

app = FastAPI(title="LLMUbuntu", version=__version__)
assistant = LocalAssistant()

# In-memory conversation store. Fine for a single-process dev scaffold.
_messages: list[dict] = []
_ids = itertools.count(1)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, description="User message text.")


class ChatMessage(BaseModel):
    id: int
    role: str
    content: str


class ChatResponse(BaseModel):
    user: ChatMessage
    assistant: ChatMessage


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "version": __version__, "messages": len(_messages)}


@app.get("/api/messages", response_model=list[ChatMessage])
def list_messages() -> list[dict]:
    return _messages


@app.post("/api/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> dict:
    user_msg = {"id": next(_ids), "role": "user", "content": request.message}
    reply_text = assistant.reply(request.message)
    assistant_msg = {"id": next(_ids), "role": "assistant", "content": reply_text}
    _messages.append(user_msg)
    _messages.append(assistant_msg)
    return {"user": user_msg, "assistant": assistant_msg}


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
