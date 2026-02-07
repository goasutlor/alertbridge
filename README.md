# AlertBridge

Stateless webhook relay and transformer for OpenShift. Receives JSON alerts from OCP Alertmanager, Confluent Platform, or other sources; transforms them via YAML rules; forwards to HTTPS targets.

**Author:** Sontas Jiamsripong  

**Docs:** [ARCHITECTURE.md](ARCHITECTURE.md) · [FEATURES.md](FEATURES.md)

---

## Features

- **FastAPI + Uvicorn** — async HTTP forwarding with httpx
- **YAML rules** — include/drop/rename/enrich/map, output template
- **Config UI** — save, reload, preview transform in browser
- **Live & Failed Events** — in-memory feed (20 display / 200 stored)
- **Target status** — Phase1 server + Phase2 API handshake
- **OCP & Confluent** — alert summary, Field Mapper, API Keys
- **i18n** — English / ไทย
- **Prometheus metrics** — JSON logs, stateless, scale-friendly

---

## Quick Start

```bash
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt

$env:ALERTBRIDGE_RULES_PATH = ".\rules.example.yaml"
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

Open UI at `http://localhost:8080`.

---

## Run with HTTPS

For webhooks that require HTTPS:

```powershell
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj /CN=localhost
$env:ALERTBRIDGE_RULES_PATH = ".\rules.example.yaml"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8443 --ssl-keyfile key.pem --ssl-certfile cert.pem
```

Or use `.\scripts\run_https.ps1`.

---

## Test

### Load test (simulate webhooks)

```powershell
python scripts/load_test_webhook.py
python scripts/load_test_webhook.py --duration 30 --concurrency 20
```

### Forward test (mock receiver)

```powershell
# Terminal 1
python scripts/mock_receiver.py

# Terminal 2
$env:ALERTBRIDGE_RULES_PATH = ".\rules.example.yaml"
$env:TARGET_URL_OCP = "http://127.0.0.1:9999/webhook"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8080

# Terminal 3
python scripts/load_test_webhook.py
```

Check: UI at http://localhost:8080 · Mock receiver at http://127.0.0.1:9999/

### HTTPS target (self-signed)

Add `verify_tls: false` to target in Config (YAML) for internal self-signed certs.

---

## Deploy to OpenShift

**Option A – Pull pre-built image from GHCR**

```bash
oc apply -f deploy/install-ocp-pull.yaml
```

Image: `ghcr.io/goasutlor/alertbridge-lite:latest` (or `:v1.0.07022026`)

**Option B – Build from Git**

```bash
oc apply -f deploy/install-ocp.yaml
oc start-build alertbridge-lite -n alertbridge
```

See [deploy/OCP_DEPLOY.md](deploy/OCP_DEPLOY.md) for full setup.

---

## Example Webhook

```bash
curl -X POST http://localhost:8080/webhook/ocp \
  -H "Content-Type: application/json" \
  -d '{"status":"firing","labels":{"severity":"critical","alertname":"DiskFull"},"annotations":{"summary":"Disk 95%"}}'
```

---

## Config (rules.yaml)

```yaml
version: 1
defaults:
  target_timeout_connect_sec: 2
  target_timeout_read_sec: 5
routes:
  - name: ocp-alertmanager
    match:
      source: ocp
    target:
      url_env: TARGET_URL_OCP
      api_key_header: X-API-Key
      api_key_env: TARGET_API_KEY_OCP
      # verify_tls: false   # for self-signed targets
    transform:
      include_fields: [alerts, commonAnnotations, commonLabels, groupLabels]
```

---

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /webhook/{source}` | Receive, transform, forward |
| `GET /` | Config UI |
| `GET /healthz`, `/readyz` | Health check |
| `GET /version` | Version & git SHA |
| `GET /metrics` | Prometheus |

---

## Security

- **VA Test:** See [VA_TEST.md](VA_TEST.md)
- **Scan:** `pip-audit` · See [SECURITY.md](SECURITY.md)
