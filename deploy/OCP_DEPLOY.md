# Deploy alertbridge-lite on OpenShift (Production)

Guide for deploying on OCP with OCP Alertmanager and Confluent Platform sending webhooks over HTTPS.

## Dev → Prod Workflow

Test local → Push Git → OCP deploy → Same results 100%.

- **Local**: `ALERTBRIDGE_RULES_PATH=./rules.example.yaml` + `persist_rules` → save to file
- **OCP**: `ALERTBRIDGE_CONFIGMAP_NAME=alertbridge-rules` + `persist_rules` → patch ConfigMap
- Same code path (`persist_rules`), different backend → identical business logic across envs
- Add features, push → OCP rebuilds → same behavior as local

## Architecture

```
[OCP Alertmanager]  --HTTPS-->  [alertbridge-lite]  --HTTP/HTTPS-->  [Target]
[Confluent Platform] --HTTPS-->       (Route + TLS)                      (configurable)
```

- **Inbound**: OCP Alertmanager and Confluent send webhooks to alertbridge-lite via **HTTPS** (OpenShift Route)
- **Outbound**: alertbridge-lite forwards to target (HTTP or HTTPS per config)

## HTTPS and Wildcard Cert (*.apps.domain)

### No cert exchange required

- **Server (alertbridge-lite)**: Uses wildcard cert `*.apps.domain` via OpenShift Route
- **Client (OCP Alertmanager, Confluent)**: Uses API Key in header, no client cert
- Route presents cert for client verification only

### Using your wildcard cert on Route

**Option A – Use default cluster cert (easiest)**  
If OpenShift already uses a wildcard, the Route gets HTTPS automatically.

**Option B – Use your wildcard cert on Route**
```bash
oc create route edge alertbridge-lite \
  --service=alertbridge-lite \
  --host=alertbridge-lite-alertbridge.apps.cluster.domain \
  --cert=path/to/your-wildcard.crt \
  --key=path/to/your-wildcard.key \
  -n alertbridge
```

**Option C – Use default ingress cert**  
If your wildcard is bound to the default ingress controller, it applies to all Routes.

## Deploy

```bash
# 1. Set namespace if needed
export NAMESPACE=alertbridge
oc new-project $NAMESPACE 2>/dev/null || oc project $NAMESPACE

# 2. Set spec.host in Route to match *.apps.domain if needed

# 3. Apply
oc apply -f deploy/k8s.yaml
# Or with BuildConfig: oc apply -f deploy/install-ocp.yaml
# Then: oc start-build alertbridge-lite -n alertbridge

# 4. Get Route URL
oc get route alertbridge-lite -n alertbridge
```

## Config OCP Alertmanager

In Alertmanager config (Secret or ConfigMap):

```yaml
receivers:
  - name: webhook-alertbridge
    webhook_configs:
      - url: 'https://alertbridge-lite-alertbridge.apps.cluster.domain/webhook/ocp'
        send_resolved: true
        http_config:
          bearer_token: '<API_KEY>'
```

Or with `authorization` header:
```yaml
http_config:
  authorization:
    type: Bearer
    credentials: "<API_KEY>"
```

Ensure API Key matches the one generated in alertbridge-lite (API Keys section).

## Config Confluent Platform

In Confluent notification / webhook config:
- URL: `https://alertbridge-lite-alertbridge.apps.cluster.domain/webhook/confluent`
- Headers: `X-API-Key: <API_KEY>` or `Authorization: Bearer <API_KEY>`
- Content-Type: `application/json`

## Webhook Paths

| Source   | Path                | Used by              |
|----------|---------------------|----------------------|
| ocp      | `/webhook/ocp`      | OCP Alertmanager     |
| confluent| `/webhook/confluent`| Confluent Platform   |

Paths come from `match.source` in route config (not hardcoded).

## Cross-Cluster

If OCP Alertmanager or Confluent runs in a different cluster:
- Use the **external Route URL** e.g. `https://alertbridge-lite-xxx.apps.cluster-a.domain`
- Verify DNS and network between clusters
- Wildcard cert must cover the domain used

## Verification

1. **Health**: `curl -k https://<route-host>/healthz`
2. **Test webhook**:
   ```bash
   curl -X POST "https://<route-host>/webhook/ocp" \
     -H "X-API-Key: <API_KEY>" \
     -H "Content-Type: application/json" \
     -d '{"version":"4","status":"firing","alerts":[{"status":"firing","labels":{"alertname":"Test"}}]}'
   ```
3. **Live Events in UI**: `https://<route-host>/`

## Save from UI (Permanent)

When deployed with `install-ocp.yaml` or `k8s.yaml` (ServiceAccount + RBAC):
- Edit Rules, Target URL, API Keys in the web UI and click **Save** to **patch ConfigMap directly**
- Changes are **permanent** (same as localhost); no `oc edit` or `/admin/reload` needed

## Compatibility

- **OCP Alertmanager**: Webhook format supported (incl. v4)
- **Confluent Platform**: Confluent webhook format supported
- Authentication: `X-API-Key` or `Authorization: Bearer` (both sides support header-based auth)
