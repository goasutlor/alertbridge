# AlertBridge

Alert relay and transformer for OpenShift/Kubernetes. AlertBridge receives webhook payloads, transforms them with route rules, forwards to target systems, and keeps durable failed records (DLQ) on PVC for trace and recovery.

**Author:** Sontas Jiamsripong  
**Docs:** [ARCHITECTURE.md](ARCHITECTURE.md) · [FEATURES.md](FEATURES.md) · [deploy/OCP_DEPLOY.md](deploy/OCP_DEPLOY.md)

---

## What You Get

- Fast API service (`FastAPI` + `httpx`) for webhook receive/transform/forward
- Route-based transform (map/include/drop/rename/enrich/template)
- Modern light UI (EN/TH) with live events, failed events, DLQ, daily metrics
- Durable DLQ on PVC (`20Gi` default in OpenShift pull manifest)
- Daily counters on PVC (`incoming`, `fwd ok`, `fwd fail`, `dlq`)
- Request traceability with base request id and retry metadata
- In-cluster webhook URL helper for internal clients
- Prometheus endpoint and operational status badges

---

## UI Snapshot

### 1) Overview: status badges, realtime metrics, request count

![AlertBridge overview](docs/images/ui/ui-overview.png)

### 2) Live and Failed events with paging

![Live and failed events](docs/images/ui/ui-live-failed-events.png)

### 3) DLQ table (durable failed forward history on PVC)

![DLQ table](docs/images/ui/ui-dlq-table.png)

### 4) Daily metrics (persisted counters)

![Daily metrics](docs/images/ui/ui-daily-metrics.png)

### 5) Field Mapper (source-to-target transform mapping)

![Field mapper](docs/images/ui/ui-field-mapper.png)

### 6) Target URLs and API key config

![Target config](docs/images/ui/ui-target-config.png)

---

## Quick Start (Local)

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

$env:ALERTBRIDGE_RULES_PATH = ".\rules.example.yaml"
python -m uvicorn app.main:app --host 0.0.0.0 --port 8080
```

Open UI: `http://localhost:8080`

---

## Run with HTTPS (Local)

```powershell
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj /CN=localhost
$env:ALERTBRIDGE_RULES_PATH = ".\rules.example.yaml"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8443 --ssl-keyfile key.pem --ssl-certfile cert.pem
```

Or use `scripts/run_https.ps1`.

---

## Deploy to OpenShift

### Option A: Pull image from GHCR (recommended)

```bash
oc apply -f deploy/install-ocp-pull.yaml
```

This single manifest includes:
- Namespace, app, service, route
- Metrics and ServiceMonitor
- DLQ PVC `20Gi` with default StorageClass
- In-cluster namespace/service env setup for internal webhook URL display

Image: `ghcr.io/goasutlor/alertbridge-lite:latest`

### Option B: Dev/Separate site

Use `deploy/install-ocp-pull-dev.yaml` for `alertbridge-dev` style deployment.

### Option C: Build from source in OpenShift

```bash
oc apply -f deploy/install-ocp.yaml
oc start-build alertbridge-lite -n alertbridge
```

More details: [deploy/OCP_DEPLOY.md](deploy/OCP_DEPLOY.md)

---

## Version Upgrade Notes

- `oc apply -f ...` updates resources from manifest (including ConfigMap defaults in file)
- If only image update is needed, prefer image update + rollout
- With RWO PVC, if rollout has mount conflict, use scale down/up (`0 -> 1`) or `Recreate` strategy

---

## Example Webhook

```bash
curl -X POST http://localhost:8080/webhook/ocp \
  -H "Content-Type: application/json" \
  -d '{"status":"firing","labels":{"severity":"critical","alertname":"DiskFull"},"annotations":{"summary":"Disk 95%"}}'
```

---

## Key API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /webhook/{source}` | Receive, transform, forward |
| `GET /` | Web UI |
| `GET /api/dlq/recent` | Recent durable DLQ rows |
| `GET /api/metrics/daily` | Daily persisted counters |
| `GET /api/in-cluster-webhook-base` | Internal webhook base URL |
| `GET /version` | Build version + namespace |
| `GET /healthz`, `GET /readyz` | Health checks |
| `GET /metrics` | Prometheus metrics |

---

## Security

- VA test guide: [VA_TEST.md](VA_TEST.md)
- Dependency scan: [SECURITY.md](SECURITY.md)
