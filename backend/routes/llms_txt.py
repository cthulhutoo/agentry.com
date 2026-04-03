"""Serve /llms.txt — a markdown file that describes Agentry for LLM consumption.

Similar to robots.txt but for AI agents. LLMs and AI agents may consult /llms.txt to understand what a site offers.
This follows the llms.txt proposal (llmstxt.org).
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["llms-txt"])

_LLMS_TXT_PATH = Path(__file__).resolve().parent.parent / "llms.txt"


@router.get("/llms.txt")
async def serve_llms_txt() -> PlainTextResponse:
    """Serve the llms.txt file."""
    try:
        content = _LLMS_TXT_PATH.read_text()
    except FileNotFoundError:
        content = "# Agentry\n\nAI Agent Directory — https://agentry.dev\nAPI: https://api.agentry.dev/api/agents\n"
        logger.warning("llms.txt not found at %s, serving fallback", _LLMS_TXT_PATH)

    return PlainTextResponse(
        content=content,
        headers={
            "Cache-Control": "public, max-age=86400",
            "Access-Control-Allow-Origin": "*",
        }
    )
