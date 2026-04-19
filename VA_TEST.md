# Vulnerability Assessment (VA) Test Report

**Reference Version:** v1.0.19042026  
**Test Date:** 2026-04-19 (dependency security bump: urllib3 2.6.x, pytest 9.x, kubernetes 35.x)  
**Standards/References:**
- OWASP Top 10 (2021)
- CWE Top 25 Most Dangerous Software Weaknesses
- Python Security Response Team (PSRT) / pip-audit
- SECURITY.md checklist

---

## 1. Test Summary

| Test Type | Result | Details |
|-----------|--------|---------|
| **Unit Test** | 13/13 passed | pytest tests/ |
| **Post Test** | 9/9 passed | API endpoints (healthz, readyz, stats, recent-*, target-status, metrics, webhook) |
| **VA Scan** | 0 CVEs (`pip-audit` clean venv) | See §4; prior scan (2026-02-07) had 30 transitive findings before pins |

---

## 2. Feature & Functionality Verification

| Feature | Status | Notes |
|---------|--------|-------|
| Webhook receive (POST /webhook/{source}) | ✅ | Body limit 1 MiB, JSON parse, route select |
| Transform payload (include/drop/rename/enrich/map) | ✅ | rules.py transform_payload |
| Forward to target (httpx POST) | ✅ | SSRF protection, http/https only |
| Alert unrolling (unroll_alerts) | ✅ | Split alerts[] and forward each |
| Circuit breaker | ✅ | 5 failures → open 60s |
| Retry (exponential backoff) | ✅ | 0, 1, 2, 4 s |
| Config auto-reload | ✅ | ALERTBRIDGE_CONFIG_WATCH_INTERVAL |
| Config CRUD (GET/PUT /api/config) | ✅ | Basic Auth, YAML safe_load |
| Admin reload | ✅ | Basic Auth |
| Basic Auth | ✅ | hmac.compare_digest (timing-safe) |
| API Key auth (webhook) | ✅ | hmac.compare_digest |
| HMAC verification (per-route) | ✅ | Timing-safe comparison |
| Live Events (20 items) | ✅ | RECENT_WEBHOOKS deque |
| Failed Events (200 stored, 20 displayed) | ✅ | RECENT_FAILED, search |
| Target Fwd status (Phase1+Phase2) | ✅ | /api/target-status |
| Alert summary in Live Events | ✅ | OCP + Confluent extraction |
| Field Mapper / Patterns | ✅ | Save, load, apply |
| Metrics (Prometheus) | ✅ | /metrics |
| Security headers | ✅ | CSP, X-Frame-Options, etc. |
| Body size limits | ✅ | 1 MiB webhook, 512 KiB config |

---

## 3. Security Controls Verified

| Control | Implementation |
|---------|----------------|
| **SSRF** | Target URL scheme restricted to http/https; follow_redirects=False |
| **YAML injection** | yaml.safe_load only (no arbitrary class loading) |
| **Auth bypass** | Basic Auth, API Key, HMAC use timing-safe comparison |
| **Secrets in logs** | sanitize_payload() redacts secret/token/password/key |
| **DoS (body)** | _read_body_with_limit streams + 413 on exceed |
| **HTTP headers** | X-Content-Type-Options, X-Frame-Options, CSP, Referrer-Policy |
| **CORS** | No wildcard; same-origin |

---

## 4. Dependency Scan (pip-audit)

**Command:** `python -m venv .venv && .venv/Scripts/pip install -r requirements.txt pip-audit && pip-audit -r requirements.txt` (Windows; use `source .venv/bin/activate` on Unix)

**Direct dependencies (requirements.txt):** fastapi, uvicorn, httpx, PyYAML, prometheus-client, python-json-logger, pydantic, kubernetes, urllib3 (explicit), pytest

**2026-04-19 findings:** **No known vulnerabilities** with pins: `kubernetes>=35,<36`, `urllib3>=2.6.3,<3`, `pytest>=9.0.3,<10` (addresses CVE-2025-71176, urllib3 CVEs/GHSAs listed in `SECURITY.md`).

**Historical (2026-02-07):** 30 known vulnerabilities in transitive deps (urllib3 1.26.x under kubernetes 28.x, older pytest, etc.).

**Recommendations:**
- Run `pip-audit` regularly after dependency changes
- Rebuild Docker/OCP images when `requirements.txt` changes
- Monitor https://github.com/pypa/advisory-database for new advisories

---

## 5. Known Limitations

1. **Basic Auth over HTTP:** Credentials sent base64; use HTTPS in production.
2. **API Keys in config:** Stored in rules YAML; use K8s Secret / external vault when possible.
3. **Transitive deps:** Some CVEs in transitive deps; upgrade path may require parent package updates.

---

## 6. Sign-off

VA test conducted per SECURITY.md checklist. All critical features and security controls verified. Dependency scan results documented; no critical unmitigated vulnerabilities in direct application code.
