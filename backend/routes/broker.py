"""Broker intake endpoints with spam filtering."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Request, HTTPException

from models import BrokerIntakeForm, BrokerIntakeRecord
from email_service import send_intake_confirmation, send_admin_notification
from spam_filter import check_broker_intake

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/broker", tags=["broker"])


def _get_store(request: Request):
    return request.app.state.store


def _get_client_ip(request: Request) -> str:
    """Extract client IP from request, respecting proxy headers."""
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("X-Real-IP", "")
    if real_ip:
        return real_ip
    return request.client.host if request.client else ""


@router.post("/intake", response_model=dict[str, Any], status_code=201)
async def submit_intake(request: Request, body: BrokerIntakeForm) -> dict[str, Any]:
    """Submit a broker intake request to find the right AI agent for your needs.

    Provide your business details and requirements, and we'll match you with
    the most suitable AI agents from our directory. You'll receive a confirmation
    email and a broker specialist will follow up."""
    # --- Spam check ---
    client_ip = _get_client_ip(request)
    form_dict = body.model_dump()
    spam_result = check_broker_intake(form_dict, client_ip=client_ip)
    if spam_result:
        logger.info("Spam blocked (broker intake) from %s: %s", client_ip, spam_result.reason)
        raise HTTPException(status_code=422, detail=spam_result.reason)

    store = _get_store(request)
    record = BrokerIntakeRecord(form=body)
    data = record.model_dump(mode="json")
    store.add_intake(data)
    logger.info("New broker intake: %s (%s)", body.business_name, record.id)

    # Send emails in background (non-blocking)
    asyncio.create_task(_send_emails(form_dict))

    return data


async def _send_emails(form_data: dict) -> None:
    """Send confirmation + admin notification emails."""
    try:
        await asyncio.gather(
            send_intake_confirmation(form_data),
            send_admin_notification(form_data),
        )
    except Exception as e:
        logger.error("Email send failed: %s", e)


@router.get("/intake/{intake_id}", response_model=dict[str, Any])
async def get_intake(request: Request, intake_id: str) -> dict[str, Any]:
    """Check the status of a previously submitted broker intake request.

    Returns the current status, any matched agents, and timestamps."""
    store = _get_store(request)
    record = store.get_intake(intake_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Intake request not found")
    return record
