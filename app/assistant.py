"""A small, dependency-free assistant.

The default backend is fully local and deterministic so the app runs end to end
without any API keys or network access. It also acts as the extension point for
plugging in a real LLM backend later (e.g. read a key from the environment and
call a provider inside ``LocalAssistant.reply``).
"""

from __future__ import annotations

import re


class LocalAssistant:
    """Deterministic, offline assistant used as the default backend."""

    def reply(self, message: str) -> str:
        text = (message or "").strip()
        if not text:
            return "Say something and I'll respond."

        lowered = text.lower()

        # Commands take precedence so payloads like "reverse hello" aren't
        # intercepted by the greeting matcher.
        for command in ("reverse", "count", "upper", "lower"):
            match = re.match(rf"^{command}\s+(.*)$", text, flags=re.IGNORECASE | re.DOTALL)
            if match:
                payload = match.group(1)
                return self._run_command(command, payload)

        if re.search(r"\b(hi|hello|hey|howdy)\b", lowered):
            return (
                "Hello! I'm the LLMUbuntu assistant. "
                "Ask me to reverse text, count words, or echo."
            )

        if lowered in {"help", "?"} or "what can you do" in lowered:
            return (
                "I can: 'reverse <text>', 'count <text>', 'upper <text>', "
                "'lower <text>', or just chat and I'll echo you back."
            )

        return f"You said: {text}"

    def _run_command(self, command: str, payload: str) -> str:
        if command == "reverse":
            return payload[::-1]
        if command == "count":
            words = len(payload.split())
            chars = len(payload)
            return f"{words} words, {chars} characters."
        if command == "upper":
            return payload.upper()
        if command == "lower":
            return payload.lower()
        return payload
