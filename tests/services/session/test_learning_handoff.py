"""Post-turn learning-handoff consolidation (#740, stage 3)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from deeptutor.services.learning_journal.store import LearningJournalStore
from deeptutor.services.path_service import PathService
from deeptutor.services.session.turns.handoff_service import (
    LearningHandoffService,
    _latest_exchange,
    _parse_handoff,
)

_EXCHANGE = [
    {"role": "user", "content": "Can we go over the sampling theorem again?"},
    {"role": "assistant", "content": "Sure — Nyquist says sample above 2B."},
]


@pytest.fixture()
def journal_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> LearningJournalStore:
    service = PathService(workspace_root=tmp_path / "data")
    monkeypatch.setattr(
        "deeptutor.services.learning_journal.store.get_path_service",
        lambda: service,
    )
    store = LearningJournalStore()
    monkeypatch.setattr(
        "deeptutor.services.learning_journal.get_learning_journal_store",
        lambda: store,
    )
    return store


class _FakeSessionStore:
    def __init__(self, messages: list[dict[str, Any]]) -> None:
        self._messages = messages
        self.reads = 0

    async def get_messages(self, session_id: str) -> list[dict[str, Any]]:
        self.reads += 1
        return list(self._messages)


class _Runtime(LearningHandoffService):
    def __init__(self, messages: list[dict[str, Any]]) -> None:
        self.store = _FakeSessionStore(messages)


def _fake_llm(monkeypatch: pytest.MonkeyPatch, *outcomes: str | Exception) -> list[dict[str, Any]]:
    """Stand in for ``llm_stream``; one outcome per call, the last one repeats."""
    calls: list[dict[str, Any]] = []

    async def stream(*, prompt: str, system_prompt: str, **_kwargs: Any):
        calls.append({"prompt": prompt, "system_prompt": system_prompt})
        outcome = outcomes[min(len(calls) - 1, len(outcomes) - 1)]
        if isinstance(outcome, Exception):
            raise outcome
        for chunk in outcome.split("|||"):
            yield chunk

    monkeypatch.setattr("deeptutor.services.llm.stream", stream)
    return calls


async def _record(runtime: _Runtime, journal_store: LearningJournalStore, **overrides: Any) -> None:
    journal = journal_store.load()
    kwargs: dict[str, Any] = {
        "session_id": "s-1",
        "handoff_stamp": journal.last_session.updated_at,
        "ui_language": "en",
    }
    kwargs.update(overrides)
    await runtime._maybe_record_learning_handoff(**kwargs)


def _draft_json(summary: str, next_focus: str) -> str:
    return f'{{"relevant": true, "summary": "{summary}", "next_focus": "{next_focus}"}}'


@pytest.mark.asyncio
async def test_learner_without_a_mission_pays_nothing(
    journal_store: LearningJournalStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = _fake_llm(monkeypatch, _draft_json("drafted", "next"))
    runtime = _Runtime(_EXCHANGE)

    await _record(runtime, journal_store)

    assert calls == []
    assert runtime.store.reads == 0
    assert journal_store.load().last_session.is_empty()


@pytest.mark.asyncio
async def test_handoff_written_during_the_turn_is_not_overwritten(
    journal_store: LearningJournalStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A note the tutor wrote itself comes from inside the context.

    Reconstructing one from the transcript afterwards is strictly a fallback,
    so the consolidator stands down whenever the handoff has moved since the
    timestamp the executor snapshotted at turn start — which is what happens
    when the tutor calls ``learning_update`` mid-turn.
    """
    journal_store.set_mission(topic="Fourier transform")
    journal_store.note_session(summary="Covered duality.", next_focus="Sampling")
    calls = _fake_llm(monkeypatch, _draft_json("stale draft", "stale focus"))

    await _record(_Runtime(_EXCHANGE), journal_store, handoff_stamp="2020-01-01T00:00:00Z")

    assert calls == []
    session = journal_store.load().last_session
    assert session.summary == "Covered duality."
    assert session.next_focus == "Sampling"


@pytest.mark.asyncio
async def test_completed_exchange_becomes_the_handoff(
    journal_store: LearningJournalStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    journal_store.set_mission(topic="Fourier transform", why="Signals coursework")
    calls = _fake_llm(
        monkeypatch,
        _draft_json("Worked through Nyquist from the spectrum picture.", "Quantization noise"),
    )

    await _record(_Runtime(_EXCHANGE), journal_store)

    assert len(calls) == 1
    assert "Fourier transform" in calls[0]["prompt"]
    assert "sampling theorem" in calls[0]["prompt"]
    session = journal_store.load().last_session
    assert session.summary == "Worked through Nyquist from the spectrum picture."
    assert session.next_focus == "Quantization noise"
    # The whole point: the next session resumes from this note.
    assert "Quantization noise" in journal_store.injection_markdown()


@pytest.mark.asyncio
async def test_irrelevant_exchange_records_nothing(
    journal_store: LearningJournalStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    journal_store.set_mission(topic="Fourier transform")
    journal_store.note_session(summary="Covered duality.", next_focus="Sampling")
    # Filled-in fields: only the `relevant` flag can keep this out, so the
    # test would fail if the flag were ignored.
    calls = _fake_llm(
        monkeypatch,
        '{"relevant": false, "summary": "Asked about the weather.", "next_focus": "nothing"}',
    )

    await _record(_Runtime(_EXCHANGE), journal_store)

    assert len(calls) == 1
    session = journal_store.load().last_session
    assert session.summary == "Covered duality."
    assert session.next_focus == "Sampling"


@pytest.mark.asyncio
async def test_unparsable_model_output_records_nothing(
    journal_store: LearningJournalStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    journal_store.set_mission(topic="Fourier transform")
    _fake_llm(monkeypatch, "I think we covered the sampling theorem?")

    await _record(_Runtime(_EXCHANGE), journal_store)

    assert journal_store.load().last_session.is_empty()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        "Error: {'message': 'Authentication Fails, Your api key: *** is invalid'}",
        '{"error": {"code": 401}}',
        "错误：调用失败",
    ],
)
async def test_streamed_provider_error_never_becomes_the_handoff(
    journal_store: LearningJournalStore,
    monkeypatch: pytest.MonkeyPatch,
    payload: str,
) -> None:
    """``llm_stream`` surfaces a failure as content, not as an exception.

    The handoff is injected into every later session for this learner, so a
    note written from an error payload would mislead them about their own
    progress until something else overwrote it.
    """
    journal_store.set_mission(topic="Fourier transform")
    journal_store.note_session(summary="Covered duality.", next_focus="Sampling")
    _fake_llm(monkeypatch, payload)

    await _record(_Runtime(_EXCHANGE), journal_store)

    session = journal_store.load().last_session
    assert (session.summary, session.next_focus) == ("Covered duality.", "Sampling")


@pytest.mark.asyncio
async def test_model_failure_leaves_the_turn_and_the_journal_intact(
    journal_store: LearningJournalStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    journal_store.set_mission(topic="Fourier transform")
    journal_store.note_session(summary="Covered duality.", next_focus="Sampling")
    _fake_llm(monkeypatch, RuntimeError("no key configured"))

    await _record(_Runtime(_EXCHANGE), journal_store)

    session = journal_store.load().last_session
    assert session.summary == "Covered duality."


@pytest.mark.asyncio
async def test_transcript_without_an_answer_is_not_worth_a_call(
    journal_store: LearningJournalStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    journal_store.set_mission(topic="Fourier transform")
    calls = _fake_llm(monkeypatch, _draft_json("drafted", "next"))

    await _record(_Runtime([{"role": "user", "content": "hello"}]), journal_store)

    assert calls == []


def test_latest_exchange_reads_backwards_from_the_newest_turn() -> None:
    messages = [
        {"role": "user", "content": "first question"},
        {"role": "assistant", "content": "first answer"},
        {"role": "user", "content": "second question"},
        {"role": "assistant", "content": ""},
        {"role": "tool", "content": "tool noise"},
        {"role": "assistant", "content": "second answer"},
    ]

    assert _latest_exchange(messages) == ("second question", "second answer")
    assert _latest_exchange([]) == ("", "")


def test_parse_handoff_accepts_a_fenced_draft() -> None:
    raw = "```json\n" + _draft_json("Covered sampling.", "Do aliasing next.") + "\n```"

    assert _parse_handoff(raw) == ("Covered sampling.", "Do aliasing next.")


def test_parse_handoff_treats_an_empty_draft_as_nothing_to_record() -> None:
    assert _parse_handoff("") is None
    assert _parse_handoff('{"relevant": true, "summary": "", "next_focus": ""}') is None
