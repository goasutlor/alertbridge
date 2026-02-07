# Alert Generator

ชุดทดสอบสำหรับ **AlertBridge** — เครื่องมือยิง Alert ตาม Standard Pattern ของ OCP และ Confluent เพื่อทดสอบการรับและ Forward ของ AlertBridge ให้มั่นใจว่าทำงานถูกต้อง

## ความสัมพันธ์กับ AlertBridge

- **AlertBridge** = Stateless webhook relay/transformer รับ webhook จาก OCP/Confluent แล้ว transform และ forward ไปยัง target
- **Alert Generator** = เครื่องมือสร้างและยิง webhook ไปยัง AlertBridge เพื่อทดสอบ end-to-end

```
[Alert Generator] --POST JSON--> [AlertBridge /webhook/ocp] --> [Target]
```

## คุณสมบัติ

- **2 Alert Pattern**: OCP (Prometheus/Alertmanager) และ Confluent Cloud
- **Manual Values**: ระบุค่าเอง (alertname, severity, namespace, pod, summary, description, etc.) เพื่อ verify ว่าข้อมูลถึงปลายทาง
- **Payload Preview**: ดู payload ที่จะส่งก่อนยิง
- **Target + API Key**: เพิ่ม Target ได้หลายรายการ รองรับ X-API-Key และ Bearer
- **จำนวน & EPS**: Rate limiting สำหรับ load test
- **Random Info**: สุ่ม payload เมื่อไม่กรอก Manual

## การรัน

```bash
cd alert-generator
npm install
cd client && npm install && cd ..
npm run dev
```

เปิด `http://localhost:3000` (หรือ port ที่ Vite แสดง)

Backend อยู่ที่ port 5001 — ถ้าเจอ 404 ให้รัน `npm run dev` จากโฟลเดอร์ `alert-generator`

## ทดสอบกับ AlertBridge

1. รัน **AlertBridge**: `uvicorn app.main:app --host 127.0.0.1 --port 8081`
2. รัน **Alert Generator**: `npm run dev` จากโฟลเดอร์ `alert-generator`
3. ใน Alert Generator: เพิ่ม Target `http://127.0.0.1:8081/webhook/ocp` พร้อม API Key (ถ้า AlertBridge ต้องการ)
4. ยิง Alert แล้วตรวจสอบ AlertBridge UI ว่าข้อมูลถึงและ Forward ถูกต้อง

## โครงสร้าง

- `server/` — Express API (POST /api/send, POST /api/payload/preview)
- `client/` — React (Vite)
