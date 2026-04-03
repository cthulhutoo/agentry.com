"""Server-side spam filtering for Agentry form submissions.

Multi-layered defense:
1. Gibberish detection — random strings fail word-ratio checks
2. Rate limiting — per-IP, per-email throttling
3. Disposable email blocking — rejects known throwaway domains
4. Content validation — min lengths, real words, URL format
5. Turnstile verification — Cloudflare Turnstile token validation
"""

from __future__ import annotations

import logging
import re
import time
from collections import defaultdict
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Rate limiting (in-memory — resets on restart, fine for MVP)
# ---------------------------------------------------------------------------

_ip_submissions: dict[str, list[float]] = defaultdict(list)
_email_submissions: dict[str, list[float]] = defaultdict(list)

RATE_LIMIT_IP = 5       # max submissions per IP per window
RATE_LIMIT_EMAIL = 3    # max submissions per email per window
RATE_WINDOW = 3600      # 1 hour window (seconds)


def _check_rate_limit(key: str, store: dict[str, list[float]], limit: int) -> bool:
    """Return True if rate limit exceeded."""
    now = time.time()
    # Clean old entries
    store[key] = [t for t in store[key] if now - t < RATE_WINDOW]
    if len(store[key]) >= limit:
        return True
    store[key].append(now)
    return False


# ---------------------------------------------------------------------------
# Disposable / throwaway email domains
# ---------------------------------------------------------------------------

DISPOSABLE_DOMAINS = {
    "mailinator.com", "guerrillamail.com", "guerrillamail.net",
    "tempmail.com", "throwaway.email", "yopmail.com", "maildrop.cc",
    "dispostable.com", "temp-mail.org", "fakeinbox.com",
    "sharklasers.com", "guerrillamailblock.com", "grr.la",
    "10minutemail.com", "trashmail.com", "mailnesia.com",
    "tempinbox.com", "discard.email", "mailcatch.com",
    "mintemail.com", "burpcollaborator.net", "mailsac.com",
    "harakirimail.com", "getnada.com", "inboxkitten.com",
    "mohmal.com", "emailondeck.com", "crazymailing.com",
    "mailtrap.io",  # testing tool, not real user
}


def _is_disposable_email(email: str) -> bool:
    """Check if email uses a known disposable domain."""
    if not email or "@" not in email:
        return False
    domain = email.split("@")[-1].lower()
    return domain in DISPOSABLE_DOMAINS


# ---------------------------------------------------------------------------
# Gibberish detection
# ---------------------------------------------------------------------------

# Common English words (short list for fast lookup)
COMMON_WORDS = {
    "the", "be", "to", "of", "and", "a", "in", "that", "have", "i",
    "it", "for", "not", "on", "with", "he", "as", "you", "do", "at",
    "this", "but", "his", "by", "from", "they", "we", "say", "her",
    "she", "or", "an", "will", "my", "one", "all", "would", "there",
    "what", "so", "up", "out", "if", "about", "who", "get", "which",
    "go", "me", "when", "make", "can", "like", "time", "no", "just",
    "him", "know", "take", "people", "into", "year", "your", "good",
    "some", "could", "them", "see", "other", "than", "then", "now",
    "look", "only", "come", "its", "over", "think", "also", "back",
    "after", "use", "two", "how", "our", "work", "first", "well",
    "way", "even", "new", "want", "because", "any", "these", "give",
    "day", "most", "us", "need", "help", "agent", "business", "email",
    "company", "support", "sales", "marketing", "customer", "data",
    "service", "product", "team", "ai", "tool", "platform", "software",
    "integration", "workflow", "automation", "crm", "chat", "bot",
    "lead", "outreach", "content", "analytics", "manage", "build",
    "looking", "automate", "improve", "better", "reduce", "increase",
    "currently", "using", "interested", "exploring", "need", "want",
}


def _gibberish_score(text: str) -> float:
    """Return 0.0-1.0 score where 1.0 = definitely gibberish.
    
    Checks:
    - Ratio of consecutive consonants (real words rarely have 5+ in a row)
    - Ratio of recognized English words
    - Entropy-like measure of character distribution
    """
    if not text or len(text.strip()) < 3:
        return 0.0

    text_lower = text.lower().strip()

    # Check 1: Consecutive consonant clusters (gibberish indicator)
    consonant_clusters = re.findall(r'[bcdfghjklmnpqrstvwxyz]{5,}', text_lower)
    cluster_score = min(len(consonant_clusters) / max(len(text_lower.split()), 1), 1.0)

    # Check 2: Word recognition ratio
    words = re.findall(r'[a-z]+', text_lower)
    if words:
        recognized = sum(1 for w in words if w in COMMON_WORDS or len(w) <= 2)
        word_score = 1.0 - (recognized / len(words))
    else:
        word_score = 0.5

    # Check 3: Case randomness (random strings often have unusual case patterns)
    if len(text) > 10:
        upper_count = sum(1 for c in text if c.isupper())
        upper_ratio = upper_count / len(text)
        case_score = 1.0 if 0.3 < upper_ratio < 0.7 else 0.0
    else:
        case_score = 0.0

    # Check 4: Lack of spaces in long text
    if len(text_lower) > 15 and ' ' not in text_lower:
        no_space_score = 0.8
    else:
        no_space_score = 0.0

    # Weighted average
    score = (cluster_score * 0.3 + word_score * 0.35 + case_score * 0.15 + no_space_score * 0.2)
    return min(score, 1.0)


def _is_gibberish(text: str, threshold: float = 0.55) -> bool:
    """Return True if text appears to be random gibberish."""
    return _gibberish_score(text) > threshold


# ---------------------------------------------------------------------------
# URL validation
# ---------------------------------------------------------------------------

def _is_valid_url(url: str) -> bool:
    """Check if URL looks legitimate."""
    if not url:
        return False
    url_pattern = re.compile(
        r'^https?://'
        r'[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?'
        r'(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)*'
        r'\.[a-zA-Z]{2,}'
        r'(/.*)?$'
    )
    return bool(url_pattern.match(url))


# ---------------------------------------------------------------------------
# Cloudflare Turnstile verification
# ---------------------------------------------------------------------------

TURNSTILE_SECRET = ""  # Set via env var; empty = skip verification
TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


async def verify_turnstile(token: str, ip: str | None = None) -> bool:
    """Verify a Cloudflare Turnstile token. Returns True if valid."""
    if not TURNSTILE_SECRET:
        # Turnstile not configured — skip (rely on other checks)
        return True
    if not token:
        return False
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(TURNSTILE_VERIFY_URL, data={
                "secret": TURNSTILE_SECRET,
                "response": token,
                "remoteip": ip or "",
            })
            result = resp.json()
            return result.get("success", False)
    except Exception as exc:
        logger.warning("Turnstile verification failed: %s", exc)
        return True  # Fail open if Turnstile is down


# ---------------------------------------------------------------------------
# Main spam check functions
# ---------------------------------------------------------------------------

class SpamResult:
    """Result of a spam check."""
    def __init__(self, is_spam: bool = False, reason: str = ""):
        self.is_spam = is_spam
        self.reason = reason

    def __bool__(self):
        return self.is_spam


def check_broker_intake(
    form_data: dict[str, Any],
    client_ip: str = "",
) -> SpamResult:
    """Check a broker intake submission for spam.
    
    Returns SpamResult(is_spam=True, reason="...") if spam detected.
    """
    email = form_data.get("email", "").strip()
    business_name = form_data.get("business_name", "").strip()
    needs = form_data.get("needs", "").strip()
    tools = form_data.get("tools", "").strip()

    # Rate limit by IP
    if client_ip and _check_rate_limit(f"ip:{client_ip}", _ip_submissions, RATE_LIMIT_IP):
        return SpamResult(True, "Rate limit exceeded. Please try again later.")

    # Rate limit by email
    if email and _check_rate_limit(f"email:{email}", _email_submissions, RATE_LIMIT_EMAIL):
        return SpamResult(True, "Too many submissions from this email. Please try again later.")

    # Disposable email check
    if _is_disposable_email(email):
        return SpamResult(True, "Please use a business email address.")

    # Basic field validation
    if not email or "@" not in email or "." not in email.split("@")[-1]:
        return SpamResult(True, "Please provide a valid email address.")

    if not business_name or len(business_name) < 2:
        return SpamResult(True, "Please provide your business name.")

    if not needs or len(needs) < 10:
        return SpamResult(True, "Please describe your needs in more detail (at least 10 characters).")

    # Gibberish detection on text fields
    if _is_gibberish(business_name):
        return SpamResult(True, "Business name appears invalid.")

    if _is_gibberish(needs):
        return SpamResult(True, "Description appears invalid. Please describe your needs in plain language.")

    if tools and _is_gibberish(tools):
        return SpamResult(True, "Tools field appears invalid.")

    return SpamResult(False)


def check_agent_registration(
    form_data: dict[str, Any],
    client_ip: str = "",
) -> SpamResult:
    """Check an agent registration submission for spam."""
    email = form_data.get("contact_email", "").strip()
    name = form_data.get("name", "").strip()
    url = form_data.get("url", "").strip()
    description = form_data.get("description", "").strip()

    # Rate limit by IP
    if client_ip and _check_rate_limit(f"ip:{client_ip}", _ip_submissions, RATE_LIMIT_IP):
        return SpamResult(True, "Rate limit exceeded. Please try again later.")

    # Rate limit by email
    if email and _check_rate_limit(f"email:{email}", _email_submissions, RATE_LIMIT_EMAIL):
        return SpamResult(True, "Too many submissions from this email.")

    # Disposable email check
    if _is_disposable_email(email):
        return SpamResult(True, "Please use a business email address.")

    # Email format
    if not email or "@" not in email or "." not in email.split("@")[-1]:
        return SpamResult(True, "Please provide a valid email address.")

    # Agent name
    if not name or len(name) < 2:
        return SpamResult(True, "Please provide the agent name.")

    if _is_gibberish(name):
        return SpamResult(True, "Agent name appears invalid.")

    # URL validation
    if not _is_valid_url(url):
        return SpamResult(True, "Please provide a valid URL (https://...).")

    # Description
    if not description or len(description) < 20:
        return SpamResult(True, "Please provide a description (at least 20 characters).")

    if _is_gibberish(description):
        return SpamResult(True, "Description appears invalid. Please describe the agent in plain language.")

    return SpamResult(False)
