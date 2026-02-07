# Security

## Vulnerability assessment checklist

- **Dependencies**: Use `pip-audit` or `safety check` regularly. Pin versions in `requirements.txt`.
- **Secrets**: No plain passwords in config; use env vars (`password_env`, `BASIC_AUTH_PASSWORD`, etc.) and mount via Kubernetes Secret.
- **YAML**: Only `yaml.safe_load` / `yaml.safe_dump` (no arbitrary class loading).
- **Forward URL**: Target URL from env only; scheme restricted to `http`/`https` (no `file:`, `gopher:`, etc.). Redirects disabled (`follow_redirects=False`) to avoid redirect-based SSRF.
- **Auth**: Basic Auth uses `hmac.compare_digest` for password comparison (timing-safe). HMAC verification uses timing-safe comparison.
- **Logging**: Payloads sanitized (secret/token/password/key redacted) before logging.
- **Request body**: Size limits (1 MiB webhook/transform, 512 KiB config) to mitigate DoS. All admin JSON endpoints use `_read_json_with_limit`.
- **Path/transform**: Max path depth 20, max array index 10000 to prevent DoS via crafted YAML paths.
- **Headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Content-Security-Policy` applied.
- **CORS**: No wildcard CORS; same-origin by default. Do not add `*` with credentials.
- **HTTPS**: Run behind TLS (e.g. OpenShift Route edge TLS). Basic Auth over HTTP sends credentials in base64; use HTTPS in production.

## Reporting vulnerabilities

Please report security issues privately (e.g. to your security team or maintainer) rather than in public issues.
