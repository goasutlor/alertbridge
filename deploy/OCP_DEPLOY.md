# Deploy alertbridge-lite on OpenShift (Production)

Guide สำหรับ deploy บน OCP ให้ OCP Alertmanager และ Confluent Platform ส่ง webhook ผ่าน HTTPS

## สถาปัตยกรรม

```
[OCP Alertmanager]  --HTTPS-->  [alertbridge-lite]  --HTTP/HTTPS-->  [Target]
[Confluent Platform] --HTTPS-->       (Route + TLS)                      (configurable)
```

- **ขาเข้า**: OCP Alertmanager และ Confluent ยิง webhook เข้ามาที่ alertbridge-lite ผ่าน **HTTPS** (OpenShift Route)
- **ขาออก**: alertbridge-lite forward ไป target (HTTP หรือ HTTPS ตาม config)

## HTTPS และ Wildcard Cert (*.apps.domain)

### ไม่ต้องแลก Cert กัน

- **Server (alertbridge-lite)**: ใช้ wildcard cert `*.apps.domain` ผ่าน OpenShift Route
- **Client (OCP Alertmanager, Confluent)**: ใช้ API Key ใน header ไม่ใช้ client cert
- ดังนั้น **ไม่มีการแลก cert** — แค่ Route present cert ให้ client เช็คเท่านั้น

### วิธีใช้ Wildcard Cert กับ Route

**Option A – ใช้ default cluster cert (ง่ายที่สุด)**  
ถ้า OpenShift ใช้ wildcard อยู่แล้ว Route จะได้ HTTPS อัตโนมัติ ไม่ต้อง config เพิ่ม

**Option B – ใช้ wildcard cert ของคุณบน Route**
สร้าง Route แบบ edge ด้วย cert โดยตรง:
```bash
oc create route edge alertbridge-lite \
  --service=alertbridge-lite \
  --host=alertbridge-lite-alertbridge.apps.cluster.domain \
  --cert=path/to/your-wildcard.crt \
  --key=path/to/your-wildcard.key \
  -n alertbridge
```
(หรือใช้ `--cert`/`--key` จากไฟล์ wildcard ที่มี *.apps.domain)

**Option C – ใช้ default ingress cert**  
ถ้า wildcard ของคุณผูกกับ default ingress controller อยู่แล้ว จะใช้ได้กับทุก Route โดยอัตโนมัติ

## Deploy

```bash
# 1. เปลี่ยน namespace ถ้าต้องการ
export NAMESPACE=alertbridge
oc new-project $NAMESPACE 2>/dev/null || oc project $NAMESPACE

# 2. แก้ spec.host ใน Route ให้ตรงกับ *.apps.domain
# เช่น alertbridge-lite-alertbridge.apps.cluster.domain

# 3. Apply
oc apply -f deploy/k8s.yaml

# 4. ดู URL ของ Route
oc get route alertbridge-lite -n alertbridge
# จะได้ URL แบบ https://alertbridge-lite-alertbridge.apps.../ 
```

## Config OCP Alertmanager

ใน Alertmanager config (Secret หรือ ConfigMap):

```yaml
receivers:
  - name: webhook-alertbridge
    webhook_configs:
      - url: 'https://alertbridge-lite-alertbridge.apps.cluster.domain/webhook/ocp'
        send_resolved: true
        http_config:
          bearer_token: '<API_KEY>'   # หรือใช้ authorization
          # หรือ authorization:
          #   credentials: <base64 of user:pass>  ถ้าใช้ Basic
```

หรือถ้าใช้ `authorization` header:
```yaml
http_config:
  authorization:
    type: Bearer
    credentials: "<API_KEY>"
```

ตรวจสอบว่า API Key ตรงกับที่ generate ใน alertbridge-lite (ส่วน API Keys)

## Config Confluent Platform

ใน Confluent notification / webhook config:
- URL: `https://alertbridge-lite-alertbridge.apps.cluster.domain/webhook/confluent`
- Headers: ใส่ `X-API-Key: <API_KEY>` หรือ `Authorization: Bearer <API_KEY>`
- Content-Type: `application/json`

## ช่องทางรับ Alert (Webhook Paths)

| Source   | Path                | ใช้กับ              |
|----------|---------------------|---------------------|
| ocp      | `/webhook/ocp`      | OCP Alertmanager    |
| confluent| `/webhook/confluent`| Confluent Platform  |

Path มาจาก `match.source` ใน route config ไม่ได้ hardcode

## ข้าม Cluster (Cross-Cluster)

ถ้า OCP Alertmanager หรือ Confluent อยู่คนละ cluster:
- ใช้ **Route URL แบบ external** เช่น `https://alertbridge-lite-xxx.apps.cluster-a.domain`
- ตรวจสอบ DNS / network ระหว่าง cluster
- Wildcard cert ต้องครอบคลุม domain ที่ใช้

## ตรวจสอบ

1. **Health**: `curl -k https://<route-host>/healthz`
2. **ส่งทดสอบ**:
   ```bash
   curl -X POST "https://<route-host>/webhook/ocp" \
     -H "X-API-Key: <API_KEY>" \
     -H "Content-Type: application/json" \
     -d '{"version":"4","status":"firing","alerts":[{"status":"firing","labels":{"alertname":"Test"}}]}'
   ```
3. **ดู Live Events** ใน UI: `https://<route-host>/`

## Compatibility

- **OCP Alertmanager**: รองรับ webhook format (รวม v4)
- **Confluent Platform**: รองรับ Confluent webhook format
- Authentication: `X-API-Key` หรือ `Authorization: Bearer` (ทั้งสองฝั่งรองรับ header-based auth)
