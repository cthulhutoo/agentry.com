"""Lightning payment endpoints via Fedimint.

Generates Lightning invoices through the Trigo federation,
checks payment status, and manages the Agentry treasury.
Uses fedimint-cli under the hood.
"""

from __future__ import annotations

import json
import logging
import subprocess
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/payments/lightning", tags=["lightning"])

FM_DATA_DIR = "/var/lib/fedimint-client"
FM_CLI = "/usr/bin/fedimint-cli"

# Platform fee percentage
PLATFORM_FEE_PCT = 5


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _run_fm(args: list[str], timeout: int = 30) -> dict:
    """Run a fedimint-cli command and return parsed JSON output."""
    cmd = [FM_CLI, "--data-dir", FM_DATA_DIR] + args
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        # Filter out log lines (start with ANSI escape or timestamp)
        stdout = result.stdout.strip()
        # Find the JSON in the output
        json_start = stdout.find("{")
        json_arr_start = stdout.find("[")
        if json_start == -1 and json_arr_start == -1:
            if result.returncode != 0:
                raise RuntimeError(result.stderr or "Command failed")
            return {"raw": stdout}
        start = min(
            json_start if json_start >= 0 else float("inf"),
            json_arr_start if json_arr_start >= 0 else float("inf"),
        )
        return json.loads(stdout[int(start):])
    except subprocess.TimeoutExpired:
        raise RuntimeError("Federation command timed out")
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Failed to parse federation response: {e}")


def _get_store(request: Request):
    return request.app.state.store


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class InvoiceRequest(BaseModel):
    """Request to create a Lightning invoice."""
    amount_sats: int = Field(
        ..., ge=1, le=1000000,
        description="Amount in satoshis (1-1,000,000)",
    )
    description: str = Field(
        default="Agentry payment",
        description="Invoice description",
    )
    dvm_pubkey: str | None = Field(
        default=None,
        description="If paying for a DVM request, the DVM's pubkey",
    )


class InvoiceResponse(BaseModel):
    """Lightning invoice for payment."""
    invoice: str
    amount_sats: int
    operation_id: str
    description: str
    platform_fee_sats: int
    expires_in_seconds: int = 3600


class PaymentStatus(BaseModel):
    """Status of a Lightning payment."""
    operation_id: str
    status: str  # pending, paid, expired, failed
    amount_sats: int = 0


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/invoice", response_model=InvoiceResponse, tags=["lightning"])
async def create_invoice(request: Request, body: InvoiceRequest):
    """Create a Lightning invoice backed by the Trigo federation.

    Generates a real mainnet Lightning invoice via Fedimint.
    Payments are settled as ecash in the Agentry treasury.
    A 5% platform fee is applied to DVM transactions.
    """
    amount_msat = body.amount_sats * 1000
    platform_fee = int(body.amount_sats * PLATFORM_FEE_PCT / 100)

    try:
        result = _run_fm([
            "ln-invoice",
            "--amount", str(amount_msat),
            "--description", body.description,
        ])
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=f"Federation error: {e}")

    invoice = result.get("invoice", "")
    operation_id = result.get("operation_id", "")

    if not invoice:
        raise HTTPException(status_code=502, detail="Failed to generate invoice")

    # Track the invoice
    store = _get_store(request)
    store.add_lightning_invoice({
        "operation_id": operation_id,
        "invoice": invoice,
        "amount_sats": body.amount_sats,
        "amount_msat": amount_msat,
        "platform_fee_sats": platform_fee,
        "description": body.description,
        "dvm_pubkey": body.dvm_pubkey,
        "status": "pending",
        "created_at": datetime.utcnow().isoformat(),
    })

    return InvoiceResponse(
        invoice=invoice,
        amount_sats=body.amount_sats,
        operation_id=operation_id,
        description=body.description,
        platform_fee_sats=platform_fee,
    )


@router.get("/status/{operation_id}", response_model=PaymentStatus, tags=["lightning"])
async def check_payment(request: Request, operation_id: str):
    """Check if a Lightning invoice has been paid.

    Polls the Fedimint federation to see if the payment has settled.
    Once paid, ecash notes are minted in the Agentry treasury.
    """
    store = _get_store(request)

    # Try to await the invoice (non-blocking with short timeout)
    try:
        result = _run_fm(["await-invoice", operation_id], timeout=5)
        # If we get here without timeout, the invoice was paid
        if result and result.get("total_amount_msat", 0) > 0:
            return PaymentStatus(
                operation_id=operation_id,
                status="paid",
                amount_sats=result.get("total_amount_msat", 0) // 1000,
            )
    except RuntimeError:
        pass  # Timeout means still pending

    return PaymentStatus(
        operation_id=operation_id,
        status="pending",
        amount_sats=0,
    )


@router.get("/balance", tags=["lightning"])
async def get_balance():
    """Get the current Agentry treasury balance on the Trigo federation.

    Shows the total ecash held, broken down by note denominations.
    """
    try:
        result = _run_fm(["info"])
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=f"Federation error: {e}")

    total_msat = result.get("total_amount_msat", 0)
    return {
        "federation": result.get("meta", {}).get("federation_name", "Unknown"),
        "federation_id": result.get("federation_id", ""),
        "network": result.get("network", ""),
        "balance_msat": total_msat,
        "balance_sats": total_msat // 1000,
        "total_notes": result.get("total_num_notes", 0),
        "denominations_msat": result.get("denominations_msat", {}),
    }
