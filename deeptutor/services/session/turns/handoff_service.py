"""Generated behavior slice of the unified turn runtime."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import TYPE_CHECKING, Any

from .._turn_runtime_shared import _clip_text

if TYPE_CHECKING:
    from deeptutor.services.session.protocol import SessionStoreProtocol

logger = logging.getLogger(__name__)

HANDOFF_TIMEOUT_SECONDS = 20.0
HANDOFF_MAX_TOKENS = 320


def _latest_exchange(messages: list[dict[str, Any]]) -> tuple[str, str]:
    """Return the newest learner question and tutor answer in a transcript."""
    learner_text = ""
    tutor_text = ""
    for message in reversed(messages):
        role = str(message.get("role") or "")
        content = str(message.get("content") or "").strip()
        if not content:
            continue
        if role == "assistant" and not tutor_text:
            tutor_text = content
        elif role == "user" and not learner_text:
            learner_text = content
        if learner_text and tutor_text:
            break
    return learner_text, tutor_text


def _handoff_prompts(
    *,
    mission_topic: str,
    learner_text: str,
    tutor_text: str,
    ui_language: str,
) -> tuple[str, str]:
    zh = str(ui_language or "").lower().startswith("zh")
    topic = mission_topic or ("（未写明）" if zh else "(not stated)")
    learner_block = _clip_text(learner_text, 1200)
    tutor_block = _clip_text(tutor_text, 3000)
    if zh:
        system_prompt = (
            "你在维护一本学习日志。给定一轮教学对话，写出让以后某次会话能够"
            "从这里接着学下去的交接记录。只输出一个 JSON 对象，包含三个键："
            "relevant（布尔）、summary（字符串）、next_focus（字符串）。"
            "如果这一轮与学习目标无关（闲聊，或与学习无关的杂活），把 relevant "
            "设为 false，另两个键留空字符串——不要编造进度。"
            "summary 用一两句话写清这一轮实际讲了什么、确认了什么结论；"
            "next_focus 用一句话写下一次该从哪里继续。"
            "字段内容使用学习者所用的语言，不要输出 Markdown。"
        )
        user_prompt = f"学习目标：{topic}\n\n[学习者]\n{learner_block}\n\n[辅导者]\n{tutor_block}"
    else:
        system_prompt = (
            "You maintain a learning journal. From one tutoring exchange, write "
            "the handoff note that lets a later session pick up exactly where "
            "this one stopped. Output a single JSON object with the keys "
            "relevant (boolean), summary (string) and next_focus (string). If "
            "the exchange had nothing to do with the learning mission, set "
            "relevant to false and leave the other two keys empty — never "
            "invent progress. summary: one or two sentences on what was "
            "actually covered or settled. next_focus: one sentence on where to "
            "continue next. Write the field values in the language the learner "
            "used, and output no markdown."
        )
        user_prompt = f"Mission: {topic}\n\n[Learner]\n{learner_block}\n\n[Tutor]\n{tutor_block}"
    return system_prompt, user_prompt


def _parse_handoff(raw: str) -> tuple[str, str] | None:
    """Read the model's draft; ``None`` means "nothing worth recording"."""
    from deeptutor.agents._shared.json_output import extract_json_object

    try:
        parsed = extract_json_object(raw)
    except (json.JSONDecodeError, ValueError):
        logger.debug("Handoff model output was not JSON — recording nothing")
        return None
    if not parsed or parsed.get("relevant") is False:
        return None
    summary = str(parsed.get("summary") or "").strip()
    next_focus = str(parsed.get("next_focus") or "").strip()
    if not summary and not next_focus:
        return None
    return summary, next_focus


class LearningHandoffService:
    """Keeps the learning journal's session handoff current after DONE."""

    if TYPE_CHECKING:
        store: SessionStoreProtocol

    async def _maybe_record_learning_handoff(
        self,
        *,
        session_id: str,
        handoff_stamp: str,
        ui_language: str,
    ) -> None:
        """Draft the handoff the tutor did not write itself.

        The journal only helps a learner resume if it is current, and
        ``learning_update`` is voluntary: when the model skips it, the next
        conversation inherits a stale "last time" and the carried-over mission
        actively misleads. This runs once per completed turn and only for
        learners who already pinned a mission, so nobody pays for a journal
        they never opened. A note written during the turn is preferred and
        makes this return early — it comes from inside the context instead of
        being reconstructed from the transcript afterwards.
        """
        if not session_id:
            return

        from deeptutor.services.learning_journal import get_learning_journal_store

        journal_store = get_learning_journal_store()
        journal = journal_store.load()
        if journal.mission.is_empty():
            return
        if journal.last_session.updated_at != handoff_stamp:
            return

        learner_text, tutor_text = _latest_exchange(await self.store.get_messages(session_id))
        if not learner_text or not tutor_text:
            return

        draft = await self._draft_learning_handoff(
            mission_topic=journal.mission.topic,
            learner_text=learner_text,
            tutor_text=tutor_text,
            ui_language=ui_language,
        )
        if draft is None:
            return
        summary, next_focus = draft

        try:
            result = journal_store.note_session(summary=summary, next_focus=next_focus)
        except Exception:
            # Not debug: this is the only writer for learners who never see the
            # tutor call `learning_update`, and a dropped handoff is invisible
            # until the next session resumes from the wrong place.
            logger.warning(
                "Could not store learning handoff for session %s", session_id, exc_info=True
            )
            return
        if not result.accepted:
            logger.debug("Learning handoff draft rejected by the journal store")

    async def _draft_learning_handoff(
        self,
        *,
        mission_topic: str,
        learner_text: str,
        tutor_text: str,
        ui_language: str,
    ) -> tuple[str, str] | None:
        system_prompt, user_prompt = _handoff_prompts(
            mission_topic=mission_topic,
            learner_text=learner_text,
            tutor_text=tutor_text,
            ui_language=ui_language,
        )

        async def _collect() -> str:
            buf: list[str] = []
            async for chunk in llm_stream(
                prompt=user_prompt,
                system_prompt=system_prompt,
                temperature=0.2,
                max_tokens=HANDOFF_MAX_TOKENS,
            ):
                buf.append(chunk)
            return "".join(buf)

        try:
            from deeptutor.services.llm import stream as llm_stream
            from deeptutor.services.model_selection.tasks import task_llm_scope

            # Entered before the task is created so `wait_for`'s inner task
            # copies it; a no-op when no task model is configured.
            with task_llm_scope():
                raw = await asyncio.wait_for(_collect(), timeout=HANDOFF_TIMEOUT_SECONDS)
            # No `_looks_like_error_payload` here, unlike the title service:
            # that guard rejects anything opening with `{`, and every real
            # draft is a JSON object. `_parse_handoff` is the stricter filter —
            # a serialised provider error has no summary in it.
            return _parse_handoff(raw)
        except asyncio.TimeoutError:
            logger.debug("Learning handoff LLM call timed out")
            return None
        except Exception:
            logger.debug("Learning handoff LLM call failed", exc_info=True)
            return None


__all__ = ["LearningHandoffService"]
