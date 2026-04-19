# Security

## Vulnerability assessment checklist

- **Dependencies**: Use `pip-audit` or `safety check` regularly. Pin versions in `requirements.txt`.

### Last dependency audit (2026-04-19)

`pip-audit -r requirements.txt` in a clean venv: **no known vulnerabilities** with current pins.

| Direct pin | Rationale |
|------------|-----------|
| `urllib3>=2.6.3,<3` | Addresses GHSA advisories chained to CVE-2025-50181, CVE-2025-66418, CVE-2025-66471, CVE-2026-21441 (redirect/decompression/streaming fixes). |
| `pytest>=9.0.3,<10` | CVE-2025-71176 (pytest `/tmp/pytest-of-*` on UNIX). |
| `kubernetes>=35,<36` | Official client allows urllib3 2.x (drops the old `urllib3<2` cap from kubernetes 28.x) so urllib3 can be upgraded safely. |

Rebuild container images after changing `requirements.txt`.

- **SBOM:** CycloneDX JSON at `sbom/cyclonedx.json` (regenerate with `scripts/generate-sbom.sh` or `scripts/generate-sbom.ps1` after dependency changes).
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
