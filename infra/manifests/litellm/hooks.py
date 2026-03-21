"""
Anthropic OAuth pre-call hook for LiteLLM Proxy.

This hook injects OAuth headers for Anthropic API calls, replacing the
traditional API key auth approach.
"""

async def async_pre_call_hook(self, user_api_key_dict, cache, data, call_type):
    """
    Runs before provider request. Mutate headers / auth here.
    """
    headers = data.get("headers") or {}
    headers["Authorization"] = f"Bearer {OAUTH_TOKEN}"
    headers["anthropic-version"] = "2023-06-01"
    headers["anthropic-beta"] = "oauth-2025-04-20"
    data["headers"] = headers

    # Make sure we don't accidentally also send x-api-key
    for k in ["api_key", "anthropic_api_key"]:
        if k in data:
            del data[k]
