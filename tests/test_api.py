from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"


def test_chat_flow():
    res = client.post("/api/chat", json={"message": "reverse hello"})
    assert res.status_code == 200
    body = res.json()
    assert body["user"]["role"] == "user"
    assert body["assistant"]["role"] == "assistant"
    assert body["assistant"]["content"] == "olleh"


def test_chat_rejects_empty():
    res = client.post("/api/chat", json={"message": ""})
    assert res.status_code == 422


def test_index_served():
    res = client.get("/")
    assert res.status_code == 200
    assert "LLMUbuntu" in res.text
