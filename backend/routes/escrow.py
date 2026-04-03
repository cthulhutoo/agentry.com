"""Agent-to-Agent Transaction Clearing via Escrow Contracts.

Provides a trustless escrow layer for agent-to-agent work agreements.
A poster agent creates a contract with a payment amount (in sats), a
deadline, and a description of the deliverable. A worker agent accepts
the contract, submits proof of completion, and the poster approves to
release funds.  Either party may open a dispute for human or automated
arbitration.

Contract lifecycle:
    open → accepted → submitted → completed
                   ↘ disputed ↗
    (also: expired, cancelled from open/accepted)

Reputation events are automatically recorded on completion and dispute
so the behavioral scoring engine in reputation.py stays in sync.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/escrow", tags=["escrow"])

# ---------------------------------------------------------------------------
# Valid status values and allowed transitions
# ---------------------------------------------------------------------------

VALID_STATUSES = {
    "open", "accepted", "submitted", "completed", "disputed", "expired", "cancelled",
}

# Maps current_status → set of statuses it can transition to
TRANSITIONS: dict[str, set[str]] = {
    "open":      {"accepted", "cancelled", "expired"},
    "accepted":  {"submitted", "disputed", "cancelled", "expired"},
    "submitted": {"completed", "disputed"},
    "completed": set(),
    "disputed":  set(),
    "expired":   set(),
    "cancelled": set(),
}


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class CreateContractRequest(BaseModel):
    """Payload for creating a new escrow contract."""

    poster_agent_id: str = Field(
        ...,
        description="Agent ID of the party posting the work (the buyer of the service).",
    )
    worker_agent_id: str | None = Field(
        default=None,
        description=(
            "Agent ID of the intended worker. Leave null to create an open contract "
            "that any agent can accept."
        ),
    )
    description: str = Field(
        ...,
        min_length=10,
        description="Human-readable description of the deliverable or service expected.",
    )
    amount_sats: int = Field(
        ...,
        gt=0,
        description="Amount in satoshis to be held in escrow and released on approval.",
    )
    deadline: str = Field(
        ...,
        description=(
            "ISO 8601 datetime by which the work must be submitted. "
            "Contracts not submitted by this time transition to 'expired'."
        ),
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Optional key-value pairs for custom fields (e.g., task type, tags).",
    )


class AcceptContractRequest(BaseModel):
    """Payload for a worker agent accepting an open contract."""

    worker_agent_id: str = Field(
        ...,
        description="Agent ID of the worker accepting responsibility for this contract.",
    )


class SubmitDeliverableRequest(BaseModel):
    """Payload for the worker submitting proof of completion."""

    proof_text: str | None = Field(
        default=None,
        description="Free-text description of the completed work or result summary.",
    )
    proof_url: str | None = Field(
        default=None,
        description="URL to a deliverable artifact, repository, or hosted result.",
    )
    notes: str = Field(
        default="",
        description="Any additional context the worker wants to pass to the poster.",
    )


class DisputeRequest(BaseModel):
    """Payload for opening a dispute on a contract."""

    raised_by: str = Field(
        ...,
        description="Agent ID of the party raising the dispute (poster or worker).",
    )
    reason: str = Field(
        ...,
        min_length=10,
        description="Explanation of why the dispute is being raised.",
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _get_store(request: Request):
    """Return the application-level data store from request state."""
    return request.app.state.store


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _assert_valid_agent(store, agent_id: str, label: str = "Agent") -> dict:
    """Raise 404 if the agent does not exist; return the agent dict otherwise."""
    agent = store.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"{label} '{agent_id}' not found")
    return agent


def _assert_contract(store, contract_id: str) -> dict:
    """Raise 404 if the contract does not exist; return it otherwise."""
    contract = store.get_escrow_contract(contract_id)
    if contract is None:
        raise HTTPException(status_code=404, detail=f"Contract '{contract_id}' not found")
    return contract


def _transition(contract: dict, target_status: str, update_fields: dict | None = None) -> dict:
    """
    Validate and apply a status transition in-place.

    Raises HTTPException 409 if the transition is not allowed from the
    current status, keeping the state machine consistent.
    """
    current = contract["status"]
    allowed = TRANSITIONS.get(current, set())
    if target_status not in allowed:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot transition contract from '{current}' to '{target_status}'. "
                f"Allowed next states: {sorted(allowed) or 'none (terminal state)'}."
            ),
        )
    contract["status"] = target_status
    contract["updated_at"] = _now_iso()
    if update_fields:
        contract.update(update_fields)
    return contract


def _record_reputation(store, agent_id: str, event_type: str, value: float = 1.0, metadata: dict | None = None) -> None:
    """Fire-and-forget reputation event recording; swallows errors to avoid breaking primary flow."""
    try:
        store.add_reputation_event({
            "agent_id": agent_id,
            "event_type": event_type,
            "value": value,
            "source": "escrow_system",
            "metadata": metadata or {},
            "timestamp": _now_iso(),
        })
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to record reputation event (%s) for %s: %s", event_type, agent_id, exc)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/contracts", status_code=201, response_model=dict[str, Any])
async def create_contract(request: Request, body: CreateContractRequest) -> dict[str, Any]:
    """Create a new escrow contract between two agents.

    The poster agent specifies the work description, payment amount in
    satoshis, and deadline.  If ``worker_agent_id`` is omitted the
    contract is *open* — any agent may call the accept endpoint to claim
    it.  If a specific worker is named the contract is still in *open*
    status until that worker explicitly accepts.

    The contract ID is returned and should be stored by both parties for
    subsequent status updates.  Funds are considered locked at creation
    time (actual Lightning/on-chain settlement is handled externally by
    the payments module).
    """
    store = _get_store(request)

    _assert_valid_agent(store, body.poster_agent_id, "Poster agent")
    if body.worker_agent_id:
        _assert_valid_agent(store, body.worker_agent_id, "Worker agent")
        if body.poster_agent_id == body.worker_agent_id:
            raise HTTPException(status_code=400, detail="Poster and worker cannot be the same agent.")

    # Validate deadline is in the future
    try:
        deadline_dt = datetime.fromisoformat(body.deadline.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid deadline format. Use ISO 8601.")

    if deadline_dt <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Deadline must be in the future.")

    contract_id = str(uuid.uuid4())
    now = _now_iso()
    contract = {
        "id": contract_id,
        "poster_agent_id": body.poster_agent_id,
        "worker_agent_id": body.worker_agent_id,
        "description": body.description,
        "amount_sats": body.amount_sats,
        "deadline": body.deadline,
        "status": "open",
        "proof_text": None,
        "proof_url": None,
        "dispute_reason": None,
        "dispute_raised_by": None,
        "metadata": body.metadata,
        "created_at": now,
        "updated_at": now,
    }
    store.add_escrow_contract(contract)
    logger.info(
        "Escrow contract created: %s | poster=%s | amount=%d sats | deadline=%s",
        contract_id, body.poster_agent_id, body.amount_sats, body.deadline,
    )
    return contract


@router.get("/contracts/{contract_id}", response_model=dict[str, Any])
async def get_contract(request: Request, contract_id: str) -> dict[str, Any]:
    """Retrieve full details of a specific escrow contract.

    Returns the complete contract record including current status,
    parties, amount, proof of delivery (if submitted), and any dispute
    information.  Both the poster and worker agents should use this
    endpoint to monitor contract progress.
    """
    store = _get_store(request)
    return _assert_contract(store, contract_id)


@router.post("/contracts/{contract_id}/accept", response_model=dict[str, Any])
async def accept_contract(request: Request, contract_id: str, body: AcceptContractRequest) -> dict[str, Any]:
    """Worker agent accepts an open escrow contract.

    Validates that the accepting agent exists and, if the contract named
    a specific worker, that the caller matches.  Transitions the contract
    from *open* → *accepted*.

    Once accepted the worker is committed to delivering the work before
    the deadline and submitting proof via ``/submit``.
    """
    store = _get_store(request)
    contract = _assert_contract(store, contract_id)
    _assert_valid_agent(store, body.worker_agent_id, "Worker agent")

    # If the contract already named a specific worker, enforce it
    if contract.get("worker_agent_id") and contract["worker_agent_id"] != body.worker_agent_id:
        raise HTTPException(
            status_code=403,
            detail=(
                f"This contract is reserved for worker '{contract['worker_agent_id']}'. "
                "Only that agent may accept it."
            ),
        )

    _transition(contract, "accepted", {"worker_agent_id": body.worker_agent_id})
    store.update_escrow_contract(contract_id, contract)

    logger.info("Contract %s accepted by worker %s", contract_id, body.worker_agent_id)
    return contract


@router.post("/contracts/{contract_id}/submit", response_model=dict[str, Any])
async def submit_deliverable(request: Request, contract_id: str, body: SubmitDeliverableRequest) -> dict[str, Any]:
    """Worker submits proof of work completion.

    At least one of ``proof_text`` or ``proof_url`` must be provided.
    Transitions the contract from *accepted* → *submitted*.

    The poster agent must then call ``/approve`` or ``/dispute`` within
    a reasonable time.  Submission does not release funds — the poster's
    explicit approval is required for that.
    """
    store = _get_store(request)
    contract = _assert_contract(store, contract_id)

    if not body.proof_text and not body.proof_url:
        raise HTTPException(
            status_code=400,
            detail="At least one of 'proof_text' or 'proof_url' must be provided.",
        )

    _transition(contract, "submitted", {
        "proof_text": body.proof_text,
        "proof_url": body.proof_url,
        "submission_notes": body.notes,
        "submitted_at": _now_iso(),
    })
    store.update_escrow_contract(contract_id, contract)

    logger.info("Contract %s submitted by worker %s", contract_id, contract.get("worker_agent_id"))
    return contract


@router.post("/contracts/{contract_id}/approve", response_model=dict[str, Any])
async def approve_contract(request: Request, contract_id: str) -> dict[str, Any]:
    """Poster approves the deliverable and releases escrowed funds.

    Transitions the contract from *submitted* → *completed*.
    On completion a ``transaction_success`` reputation event is recorded
    for both the poster and worker agents, reinforcing the behavioral
    scoring signal used by the reputation engine.

    Fund disbursement to the worker's Lightning address is handled
    asynchronously by the payments module after this status change.
    """
    store = _get_store(request)
    contract = _assert_contract(store, contract_id)

    _transition(contract, "completed", {"completed_at": _now_iso()})
    store.update_escrow_contract(contract_id, contract)

    # Reputation events for both parties
    meta = {"contract_id": contract_id, "amount_sats": contract.get("amount_sats")}
    _record_reputation(store, contract["poster_agent_id"], "transaction_success", 1.0, meta)
    if contract.get("worker_agent_id"):
        _record_reputation(store, contract["worker_agent_id"], "transaction_success", 1.0, meta)

    logger.info(
        "Contract %s completed | poster=%s | worker=%s | amount=%d sats",
        contract_id, contract["poster_agent_id"],
        contract.get("worker_agent_id"), contract.get("amount_sats", 0),
    )
    return contract


@router.post("/contracts/{contract_id}/dispute", response_model=dict[str, Any])
async def dispute_contract(request: Request, contract_id: str, body: DisputeRequest) -> dict[str, Any]:
    """Either party raises a dispute on the contract.

    Can be called from *accepted* or *submitted* state.  Transitions to
    *disputed* and records a ``transaction_dispute`` reputation event for
    the other party, which negatively impacts their trustworthiness
    dimension score.

    Disputed contracts are flagged for human or automated arbitration.
    The dispute reason is stored on the contract record for the arbitrator.
    """
    store = _get_store(request)
    contract = _assert_contract(store, contract_id)

    # Validate raiser is one of the parties
    parties = {contract["poster_agent_id"], contract.get("worker_agent_id")}
    parties.discard(None)
    if body.raised_by not in parties:
        raise HTTPException(
            status_code=403,
            detail="Only the poster or worker agent may raise a dispute.",
        )

    _transition(contract, "disputed", {
        "dispute_raised_by": body.raised_by,
        "dispute_reason": body.reason,
        "disputed_at": _now_iso(),
    })
    store.update_escrow_contract(contract_id, contract)

    # Record dispute reputation event for the *other* party
    other_party = (parties - {body.raised_by}).pop() if len(parties) > 1 else None
    if other_party:
        _record_reputation(
            store, other_party, "transaction_dispute", -1.0,
            {"contract_id": contract_id, "raised_by": body.raised_by},
        )

    logger.warning(
        "Contract %s disputed by %s: %s", contract_id, body.raised_by, body.reason
    )
    return contract


@router.get("/contracts", response_model=dict[str, Any])
async def list_contracts(
    request: Request,
    agent_id: str | None = Query(default=None, description="Filter contracts where this agent is poster or worker."),
    status: str | None = Query(default=None, description="Filter by contract status (open, accepted, submitted, completed, disputed, expired, cancelled)."),
    limit: int = Query(default=20, ge=1, le=100, description="Maximum number of contracts to return."),
    offset: int = Query(default=0, ge=0, description="Pagination offset."),
) -> dict[str, Any]:
    """List escrow contracts with optional filtering.

    Supports filtering by agent (returns contracts where the agent is
    either poster or worker) and by status.  Useful for dashboards,
    agent workload views, and audit trails.  Results are paginated.
    """
    store = _get_store(request)

    if status and status not in VALID_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status '{status}'. Must be one of: {', '.join(sorted(VALID_STATUSES))}.",
        )

    contracts, _total = store.list_escrow_contracts(agent_id=agent_id, status=status, limit=100000)

    # Sort newest first
    contracts.sort(key=lambda c: c.get("created_at", ""), reverse=True)

    total = len(contracts)
    page = contracts[offset: offset + limit]

    return {
        "items": page,
        "total": total,
        "limit": limit,
        "offset": offset,
        "filters": {"agent_id": agent_id, "status": status},
    }


@router.get("/stats", response_model=dict[str, Any])
async def escrow_stats(request: Request) -> dict[str, Any]:
    """Return platform-wide escrow statistics.

    Aggregates across all contracts to provide:
    - ``total_contracts``: all-time contract count
    - ``total_volume_sats``: cumulative sat volume across completed contracts
    - ``active_contracts``: currently open or accepted contracts
    - ``dispute_rate``: ratio of disputed contracts to all terminal contracts
    - ``completion_rate``: ratio of completed contracts to all terminal contracts
    - Per-status breakdown for operational dashboards.

    This endpoint is intentionally public — summary stats build trust
    in the platform without exposing sensitive contract details.
    """
    store = _get_store(request)
    all_contracts, _ = store.list_escrow_contracts(limit=100000)

    status_counts: dict[str, int] = {s: 0 for s in VALID_STATUSES}
    total_volume_sats = 0
    active_count = 0

    for c in all_contracts:
        st = c.get("status", "open")
        status_counts[st] = status_counts.get(st, 0) + 1
        if st == "completed":
            total_volume_sats += c.get("amount_sats", 0)
        if st in ("open", "accepted", "submitted"):
            active_count += 1

    terminal = status_counts["completed"] + status_counts["disputed"] + status_counts["expired"] + status_counts["cancelled"]
    dispute_rate = (status_counts["disputed"] / terminal) if terminal > 0 else 0.0
    completion_rate = (status_counts["completed"] / terminal) if terminal > 0 else 0.0

    return {
        "total_contracts": len(all_contracts),
        "total_volume_sats": total_volume_sats,
        "active_contracts": active_count,
        "dispute_rate": round(dispute_rate, 4),
        "completion_rate": round(completion_rate, 4),
        "status_breakdown": status_counts,
    }
