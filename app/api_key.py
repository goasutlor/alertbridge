"""API Key generation and verification for webhook authentication."""
import secrets
import hmac
from typing import Optional
from datetime import datetime, timedelta, timezone

BANGKOK = timezone(timedelta(hours=7))

from fastapi import HTTPException, Request, status

from app.config import get_rules
from app.rules import ApiKey, ApiKeyConfig


def generate_api_key() -> str:
    """Generate a secure random API key (32 bytes, hex encoded = 64 chars)."""
    return secrets.token_hex(32)


def verify_api_key(request: Request, api_key_config: Optional[ApiKeyConfig]) -> Optional[str]:
    """
    Verify API key from request header 'X-API-Key' or 'Authorization: Bearer <key>'.
    Returns the API key name if valid, None if not required, raises HTTPException if invalid.
    """
    if not api_key_config:
        return None
    
    # Get API key from header
    api_key_value = request.headers.get("X-API-Key")
    if not api_key_value:
        # Try Authorization: Bearer <key>
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            api_key_value = auth_header[7:].strip()
    
    if not api_key_value:
        if api_key_config.required:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="API key required. Provide X-API-Key header or Authorization: Bearer <key>",
            )
        return None
    
    # Verify against configured keys
    for api_key in api_key_config.keys:
        if hmac.compare_digest(api_key.key, api_key_value):
            return api_key.name
    
    # Key not found
    if api_key_config.required:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )
    return None


def create_api_key(name: str) -> ApiKey:
    """Create a new API key with the given name."""
    return ApiKey(
        name=name,
        key=generate_api_key(),
        created_at=datetime.now(BANGKOK).isoformat()[:23],
    )


def get_api_keys() -> list[dict]:
    """Get list of API keys (without exposing full key values)."""
    rules = get_rules()
    if not rules.auth or not rules.auth.api_keys:
        return []
    
    result = []
    for api_key in rules.auth.api_keys.keys:
        result.append({
            "name": api_key.name,
            "key_prefix": api_key.key[:8] + "..." if len(api_key.key) > 8 else api_key.key,
            "created_at": api_key.created_at,
        })
    return result
