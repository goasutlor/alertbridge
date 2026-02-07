# Alert Reciever

Version: 1.0.07022026

ตัวรับ Alarm แบบ HTTP/HTTPS — รับ Webhook จาก AlertBridge หรือระบบอื่น, ใช้ API Key Auth และ Pattern Mapping แปลง payload เป็น fields สำหรับตรวจสอบ

---

## ทำอะไรได้บ้าง

| ฟีเจอร์ | รายละเอียด |
|---------|-------------|
| **Webhook Receiver** | รับ `POST /webhook/{source}` — รองรับ HTTP และ HTTPS |
| **API Key Auth** | Generate API Key → ส่งให้ต้นทางใส่ใน Header `X-API-Key` — รับเฉพาะ key ที่ระบบสร้าง |
| **Pattern Mapping** | กำหนด Schema (YAML/API) ว่า JSON path ไหน map ไป field ไหน |
| **Web UI** | แท็บ Alarms / API Keys / Patterns — ดู alarms แบบ realtime, กรอง, Gen JSON schema ส่งให้ต้นทาง |
| **Raw Payload** | เก็บและแสดง Raw Body ที่รับมาจริง สำหรับ debug |
| **Route Alias** | รองรับ path เช่น `ocp-alertmanager` ให้ใช้ pattern `ocp` อัตโนมัติ |

---

## การใช้งานหลัก

1. **เปิด Web UI** → ไปที่แท็บ API Keys → Generate API Key → ส่งให้ AlertBridge ใส่ใน Target
2. **เลือก Schema** → ไปที่แท็บ Patterns → Gen JSON จาก OCP / Confluent / New-OCP-Pattern → ส่งให้ต้นทาง Map/Transform
3. **ตั้ง Target URL ที่ AlertBridge** → `https://<host>:8443/webhook/new-ocp-pattern` (หรือ ocp, confluent) พร้อม X-API-Key
4. **ดู Alarms** → แท็บ Alarms แสดงรายการ realtime, กด Raw เพื่อดู payload เต็ม

---

## การติดตั้ง

```bash
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
```

---

## การรัน

### HTTP (port 8082)

```powershell
.\scripts\run_http.ps1
# หรือ
python -m uvicorn app.main:app --host 0.0.0.0 --port 8082
```

เปิด `http://localhost:8082`

### HTTPS (port 8443)

```powershell
.\scripts\run_https.ps1
# สร้าง self-signed cert อัตโนมัติ (ใช้ Python ถ้าไม่มี openssl)
```

เปิด `https://localhost:8443`

---

## API Endpoints

| Method | Path | คำอธิบาย |
|--------|------|----------|
| POST | `/webhook/{source}` | รับ alarm — ต้องมี X-API-Key หรือ Authorization: Bearer |
| GET | `/api/alarms?source=ocp` | list alarms (filter by schema) |
| POST | `/api/alarms/clear` | ล้างรายการ alarms |
| GET | `/api/keys` | list API keys |
| POST | `/api/keys/generate` | สร้าง API key ใหม่ |
| DELETE | `/api/keys/{id}` | revoke key |
| GET | `/api/patterns` | list patterns |
| GET | `/api/patterns/{source_id}/expected-json` | Gen JSON schema ส่งให้ต้นทาง |
| POST | `/api/patterns` | สร้าง/อัปเดต pattern |
| GET | `/info` | ตรวจสอบว่า server รันอยู่ |

---

## แนวคิด: เราเป็นหลัก กำหนด Schema

- Alert Reciever กำหนด **Schema** ไว้ (OCP, Confluent, New-OCP-Pattern)
- **Gen JSON** → ได้ template ส่งให้ต้นทาง (เช่น AlertBridge)
- ต้นทาง **Map/Transform** ให้ payload ส่งมาให้ตรง Schema
- Alert Reciever รับและ map field ตาม pattern

---

## Pattern และ Route

- **source_id** = path ใน `/webhook/{source_id}` เช่น `ocp`, `new-ocp-pattern`
- **Route Alias**: `ocp-alertmanager` → ใช้ pattern `ocp` อัตโนมัติ
- **Case-insensitive**: `New-OCP-Pattern` match กับ `new-ocp-pattern`

---

## โครงสร้าง Default Patterns

ดู `config/patterns.yaml`:

- **OCP** — Prometheus/Alertmanager: `labels.*`, `annotations.*`, `startsAt`, `generatorURL`
- **Confluent** — `alert_id`, `message`, `severity`, `cluster_id`, `timestamp`
- **New-OCP-Pattern** — nested: `trace_id`, `data.origin.cluster.*`, `data.alert_details.0.meta.*`

---

## การผสานกับ AlertBridge

AlertBridge ส่ง webhook มา Alert Reciever:

1. ที่ AlertBridge → Target URL: `https://<alert-receiver-host>:8443/webhook/new-ocp-pattern`
2. API Key Header: `X-API-Key`
3. API Key Value: key ที่ Generate จาก Alert Reciever
4. TLS: Skip (self-signed) ถ้าใช้ self-signed cert
5. ถ้า AlertBridge รันใน Docker → ใช้ `https://host.docker.internal:8443/...` แทน localhost

---

## Environment Variables

| Variable | คำอธิบาย |
|----------|----------|
| `ALARM_RECEIVER_RULES_PATH` | path ไปยัง patterns.yaml (default: config/patterns.yaml) |

---

## โครงสร้างโปรเจกต์

```
Alam_reciever/
├── app/
│   ├── main.py          # FastAPI app, webhook, APIs
│   ├── api_keys.py      # API key generation
│   ├── api_key_auth.py  # auth dependency
│   ├── config.py        # pattern loading
│   ├── mapper.py        # payload → fields mapping
│   ├── pattern_gen.py   # auto-gen, expected JSON
│   └── templates/
│       └── index.html   # Web UI
├── config/
│   └── patterns.yaml    # default patterns
├── scripts/
│   ├── run_http.ps1
│   ├── run_https.ps1
│   └── gen_self_signed_cert.py
├── requirements.txt
└── README.md
```
