# alertbridge-lite

Stateless webhook relay/transformer for OpenShift. Receives JSON webhooks, applies YAML-based rules, transforms payloads, and forwards to HTTPS targets.

## Features
- FastAPI + Uvicorn, async HTTP forwarding with httpx
- YAML rules: include/drop/rename/enrich/map values/output template
- Config UI with save/reload/preview transform
- Live Events & Failed Events (search, in-memory, limit 20 display / 200 stored)
- Target Forward status (Phase1 server + Phase2 API handshake)
- Alert summary in Live Events (OCP Alertmanager + Confluent)
- EN/TH i18n, Field Mapper, API Keys
- JSON logs and Prometheus metrics
- Stateless and scale-friendly (rules cache only)

## Local Run
```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Optional: override rules path
export ALERTBRIDGE_RULES_PATH=./rules.example.yaml

uvicorn app.main:app --host 0.0.0.0 --port 8080
```

Open UI at `http://localhost:8080`.

**HTTP vs HTTPS:** For local functional testing, HTTP is enough. When you need HTTPS (e.g. webhooks from systems that require HTTPS), run uvicorn with SSL (see [Run with HTTPS](#run-with-https) below).

### Run with HTTPS

Uvicorn can serve HTTPS directly. You need a certificate and key.

**Option A – self-signed cert (local test):**
```powershell
# Generate once (Windows PowerShell; or use openssl on Linux/macOS)
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj /CN=localhost

# Run app with HTTPS
$env:ALERTBRIDGE_RULES_PATH = ".\rules.example.yaml"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8443 --ssl-keyfile key.pem --ssl-certfile cert.pem
```
Open UI at `https://127.0.0.1:8443` (browser will warn about self-signed cert; accept for testing).

**Option B – use script (generates cert if missing, then runs HTTPS):**
```powershell
.\scripts\run_https.ps1
# or with port: .\scripts\run_https.ps1 -Port 8443
```

**Option C – production:** Put a reverse proxy (nginx, Traefik, OpenShift route with TLS) in front and keep uvicorn on HTTP behind it.

### Quick test: Look & Feel + Load (simulate random webhooks)
1. **Start the app** (with example rules so `/webhook/ocp` and `/webhook/confluent` exist):
   ```powershell
   # Windows
   $env:ALERTBRIDGE_RULES_PATH = ".\rules.example.yaml"
   python -m uvicorn app.main:app --host 127.0.0.1 --port 8080
   ```
   Or use `scripts\run_local.ps1` (sets rules path and starts uvicorn).
2. **Open UI**: http://127.0.0.1:8080 — check routes, config, and Preview.
3. **Run load test** (in another terminal) to see how many requests the app can accept:
   ```powershell
   python scripts/load_test_webhook.py
   python scripts/load_test_webhook.py --duration 30 --concurrency 20
   ```
   Without `TARGET_URL_OCP` / `TARGET_URL_CONFLUENT` set, forward fails and responses are **202**; the script still measures **RPS** and **latency** (accept + transform). To test with real forward, use the mock receiver below.

### Test forward with mock receiver (verify forwarded payloads)
1. **Terminal 1 – start mock receiver** (receives forwarded webhooks):
   ```powershell
   python scripts/mock_receiver.py
   ```
   Listens on `http://127.0.0.1:9999/`. Open that URL to see received payloads (last 200).
2. **Terminal 2 – start alertbridge-lite** with target URL pointing at the mock:
   ```powershell
   $env:ALERTBRIDGE_RULES_PATH = ".\rules.example.yaml"
   $env:TARGET_URL_OCP = "http://127.0.0.1:9999/webhook"
   $env:TARGET_URL_CONFLUENT = "http://127.0.0.1:9999/webhook"
   python -m uvicorn app.main:app --host 127.0.0.1 --port 8081
   ```
3. **Terminal 3 – run load test**:
   ```powershell
   python scripts/load_test_webhook.py
   ```
4. **Check**: alertbridge-lite UI (http://127.0.0.1:8081) shows request count and live feed; **mock receiver** (http://127.0.0.1:9999/) shows the **transformed payloads** that were forwarded.
   - **HTTPS** mock: generate cert with `openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj /CN=localhost`, then `python scripts/mock_receiver.py --https --cert cert.pem --key key.pem --port 8443` and set `TARGET_URL_OCP=https://127.0.0.1:8443/webhook` (alertbridge-lite allows HTTP/HTTPS targets).

## Build Container
```bash
docker build -t alertbridge-lite:latest .
docker run --rm -p 8080:8080 \
  -e TARGET_URL_OCP=https://example.com/webhook \
  alertbridge-lite:latest
```

## Deploy to OpenShift

```bash
oc apply -f deploy/k8s.yaml
```

- **HTTPS**: Route uses TLS edge termination; clients call `https://<route-host>/webhook/ocp` or `/webhook/confluent`.
- **Wildcard cert** (`*.apps.domain`): Works with default ingress cert or bind custom cert to Route (see [deploy/OCP_DEPLOY.md](deploy/OCP_DEPLOY.md)).
- **No cert exchange**: OCP Alertmanager and Confluent use API Key in header, no client cert.

Update the `ConfigMap` and `Secret` entries with real values. See [deploy/OCP_DEPLOY.md](deploy/OCP_DEPLOY.md) for OCP Alertmanager + Confluent setup.

## Example Webhook Call
```bash
curl -X POST http://localhost:8080/webhook/ocp \
  -H "Content-Type: application/json" \
  -d '{"status":"firing","labels":{"severity":"critical","alertname":"DiskFull"},"annotations":{"summary":"Disk 95%"}}'
```

## Metrics
```bash
curl http://localhost:8080/metrics
```

Metrics exported:
- `alertbridge_requests_total{source,route,status}`
- `alertbridge_forward_total{route,result}`
- `alertbridge_forward_latency_seconds{route}`
- `alertbridge_config_reload_total{result}`
- `alertbridge_hmac_verify_total{route,result}` (when HMAC is enabled per route)

## Config Schema
Rules are loaded from `/etc/alertbridge/rules.yaml` by default (override with `ALERTBRIDGE_RULES_PATH`).

Example:
```yaml
version: 1
defaults:
  target_timeout_connect_sec: 2
  target_timeout_read_sec: 5
routes:
  - name: ocp-alertmanager
    match:
      source: "ocp"
    target:
      url_env: "TARGET_URL_OCP"
      auth_header_env: "TARGET_AUTH_OCP"
    transform:
      include_fields: ["status","labels","annotations"]
      drop_fields: ["annotations.runbook_url"]
      rename:
        labels.severity: severity
      enrich_static:
        env: "prod"
      map_values:
        severity:
          critical: "P1"
      output_template:
        type: "flat"
        fields:
          severity: "$.severity"
          message: "$.annotations.summary"
```

## Endpoints
- `POST /webhook/{source}`: transform + forward
- `POST /api/transform/{source}`: transform only (preview)
- `GET /api/config`: JSON or YAML (via `Accept: text/yaml`)
- `PUT /api/config`: update config (YAML or JSON body)
- `POST /admin/reload`: reload from rules file
- `GET /healthz`, `GET /readyz`, `GET /metrics`, `GET /`

## Basic Authentication (optional, default off)
Local user Basic Auth protects the UI and config endpoints (`/`, `/api/config`, `/admin/reload`, `/api/transform/*`). Webhook, health, and metrics are **not** protected.

**Option 1 – env (single user):**
```bash
export BASIC_AUTH_USER=admin
export BASIC_AUTH_PASSWORD=your-secret
```

**Option 2 – config (multiple users, passwords from env):**
```yaml
auth:
  basic:
    users:
      - username: admin
        password_env: BASIC_AUTH_PASSWORD_ADMIN
      - username: viewer
        password_env: BASIC_AUTH_PASSWORD_VIEWER
```

If no users are configured (no `auth.basic.users` and no `BASIC_AUTH_USER`/`BASIC_AUTH_PASSWORD`), these endpoints are not protected.

## HMAC verification (optional, default off)
Per-route HMAC signature verification is **disabled by default**. To enable for a route, add `verify_hmac`:

```yaml
routes:
  - name: my-webhook
    match:
      source: "my-source"
    target:
      url_env: "TARGET_URL"
    verify_hmac:
      secret_env: "WEBHOOK_HMAC_SECRET"
      header: "X-Signature-256"
      algorithm: "sha256"
    transform: ...
```

- `secret_env`: env var name holding the shared secret (e.g. from Secret).
- `header`: request header containing the signature (default `X-Signature-256`).
- `algorithm`: `sha256` or `sha1`. Header value may be `sha256=hexdigest` or just `hexdigest`.

If HMAC is enabled and the signature is missing or invalid, the request is rejected with `401`.

## Security and VA (Vulnerability Assessment)
- **VA Test:** Passed (Reference version v1.1.0). See [VA_TEST.md](VA_TEST.md) for full report.
- **Standards:** OWASP Top 10, CWE Top 25, pip-audit (Python advisory DB).
- Run dependency scan: `pip install pip-audit && pip-audit`
- See [SECURITY.md](SECURITY.md) for checklist and hardening notes.
- Use HTTPS in production; Basic Auth over HTTP sends credentials in base64.
- Request body limits: 1 MiB (webhook/transform), 512 KiB (config). Target URLs restricted to `http`/`https` only; redirects disabled.

## Notes
- If the rules file is read-only (ConfigMap), `PUT /api/config` returns `409`. Update the ConfigMap and call `/admin/reload`.
- Forward retries: up to 2 retries on connect timeout or 5xx with backoff 0.2s and 0.5s.
