from app.assistant import LocalAssistant


def test_greeting():
    assistant = LocalAssistant()
    assert "assistant" in assistant.reply("hello").lower()


def test_reverse():
    assert LocalAssistant().reply("reverse abc") == "cba"


def test_count():
    assert LocalAssistant().reply("count one two three") == "3 words, 13 characters."


def test_upper_lower():
    assistant = LocalAssistant()
    assert assistant.reply("upper abc") == "ABC"
    assert assistant.reply("lower ABC") == "abc"


def test_echo_fallback():
    assert LocalAssistant().reply("random text") == "You said: random text"


def test_empty():
    assert LocalAssistant().reply("   ") == "Say something and I'll respond."
