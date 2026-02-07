# Production Readiness Checklist

**AlertBridge** — Security and quality hardening applied for production deployment.

## Security Fixes Applied

| Issue | Fix |
|-------|-----|
| **Info leakage in error responses** | Config/JSON parse errors return generic messages; details logged server-side only |
| **Unbounded JSON body** | Admin endpoints (patterns, API keys) now use `_read_json_with_limit` (512 KiB cap) |
| **DoS via crafted YAML paths** | `MAX_PATH_DEPTH=20`, `MAX_ARRAY_INDEX=10000` in rules transform |
| **Swallowed config watch errors** | Exceptions logged instead of silent `pass` |
| **API key name validation** | Max 128 chars, rejects control characters |
| **Pattern limits** | Name 200 chars, source_type 100 chars, mappings max 500 |
| **XSS in escapeHtml** | Defensive handling of null/non-string in app.js |
| **Basic Auth realm** | Updated to "AlertBridge" |

## Verification

```bash
pytest tests/ -v
pip-audit   # Run before production deploy
```

## Pre-Production Checklist

- [ ] Run `pip-audit` — fix any reported vulnerabilities
- [ ] Use HTTPS (OpenShift Route TLS or reverse proxy)
- [ ] Set strong Basic Auth password via Secret
- [ ] Use API keys for webhook auth; store in Secret
- [ ] Target URLs from env/Secret only
- [ ] For self-signed targets: `verify_tls: false` only for internal services

## See Also

- [SECURITY.md](SECURITY.md) — Vulnerability assessment checklist
- [VA_TEST.md](VA_TEST.md) — VA test report
