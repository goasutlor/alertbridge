# AlertBridge — Metrics และตัวอย่าง PromQL สำหรับ Dashboard

เอกสารนี้รวมเมตริกทั้งหมดที่ AlertBridge expose ผ่าน `/metrics` (Prometheus) พร้อมตัวอย่าง Query สำหรับใช้ใน OCP Observe → Metrics หรือสร้าง Dashboard

---

## 1. รายการเมตริกและ Labels

| Metric Name | Type | Description | Labels |
|-------------|------|-------------|--------|
| `alertbridge_requests_total` | Counter | จำนวน webhook requests ที่รับเข้า | `source`, `route`, `status` |
| `alertbridge_forward_total` | Counter | จำนวนครั้งที่ forward ไป target | `route`, `result` (success/fail) |
| `alertbridge_forward_latency_seconds` | Histogram | เวลาใช้ในการ forward (วินาที) | `route` |
| `alertbridge_config_reload_total` | Counter | จำนวนครั้ง reload/save config | `result` (success/fail) |
| `alertbridge_hmac_verify_total` | Counter | จำนวนครั้งตรวจ HMAC | `route`, `result` (success/fail) |

**หมายเหตุ:** Histogram จะมี series เพิ่มเป็น `_bucket`, `_count`, `_sum` (เช่น `alertbridge_forward_latency_seconds_bucket`)

---

## 2. ตัวอย่าง Query แยกตามเมตริก

### 2.1 `alertbridge_requests_total` (ขาเข้า)

| ใช้ทำ | Query |
|--------|------|
| ค่าล่าสุด แยก source/route/status | `sum(alertbridge_requests_total) by (source, route, status)` |
| Total requests ล่าสุด | `sum(alertbridge_requests_total)` |
| อัตรา request ต่อวินาที (ทุก route) | `sum(rate(alertbridge_requests_total[5m]))` |
| อัตรา request ต่อวินาที แยก source | `sum(rate(alertbridge_requests_total[5m])) by (source)` |
| อัตรา request ต่อวินาที แยก route | `sum(rate(alertbridge_requests_total[5m])) by (route)` |
| จำนวน request แยก HTTP status | `sum(alertbridge_requests_total) by (status)` |

### 2.2 `alertbridge_forward_total` (ขา forward)

| ใช้ทำ | Query |
|--------|------|
| ค่าล่าสุด แยก route และ result | `sum(alertbridge_forward_total) by (route, result)` |
| Total forward ล่าสุด | `sum(alertbridge_forward_total)` |
| จำนวน forward สำเร็จ | `sum(alertbridge_forward_total{result="success"})` |
| จำนวน forward ล้มเหลว | `sum(alertbridge_forward_total{result="fail"})` |
| อัตรา forward ต่อวินาที | `sum(rate(alertbridge_forward_total[5m]))` |
| อัตรา forward แยก success/fail | `sum(rate(alertbridge_forward_total[5m])) by (route, result)` |
| อัตรา success ต่อวินาที | `sum(rate(alertbridge_forward_total{result="success"}[5m]))` |
| อัตรา fail ต่อวินาที | `sum(rate(alertbridge_forward_total{result="fail"}[5m]))` |

### 2.3 `alertbridge_forward_latency_seconds` (เวลา forward)

| ใช้ทำ | Query |
|--------|------|
| ค่าเฉลี่ย latency (วินาที) | `sum(rate(alertbridge_forward_latency_seconds_sum[5m])) / sum(rate(alertbridge_forward_latency_seconds_count[5m]))` |
| Latency แยก route | `sum(rate(alertbridge_forward_latency_seconds_sum[5m])) by (route) / sum(rate(alertbridge_forward_latency_seconds_count[5m])) by (route)` |
| p50 (median) latency | `histogram_quantile(0.5, sum(rate(alertbridge_forward_latency_seconds_bucket[5m])) by (le, route))` |
| p95 latency | `histogram_quantile(0.95, sum(rate(alertbridge_forward_latency_seconds_bucket[5m])) by (le, route))` |
| p99 latency | `histogram_quantile(0.99, sum(rate(alertbridge_forward_latency_seconds_bucket[5m])) by (le, route))` |
| p99 รวมทุก route | `histogram_quantile(0.99, sum(rate(alertbridge_forward_latency_seconds_bucket[5m])) by (le))` |

### 2.4 `alertbridge_config_reload_total`

| ใช้ทำ | Query |
|--------|------|
| จำนวน reload ล่าสุด แยก result | `sum(alertbridge_config_reload_total) by (result)` |
| Reload สำเร็จ | `alertbridge_config_reload_total{result="success"}` |
| Reload ล้มเหลว | `alertbridge_config_reload_total{result="fail"}` |
| อัตรา reload ต่อวินาที | `sum(rate(alertbridge_config_reload_total[5m]))` |

### 2.5 `alertbridge_hmac_verify_total`

| ใช้ทำ | Query |
|--------|------|
| จำนวน verify ล่าสุด แยก route/result | `sum(alertbridge_hmac_verify_total) by (route, result)` |
| HMAC verify สำเร็จ | `sum(alertbridge_hmac_verify_total{result="success"})` |
| HMAC verify ล้มเหลว | `sum(alertbridge_hmac_verify_total{result="fail"})` |
| อัตรา verify ต่อวินาที | `sum(rate(alertbridge_hmac_verify_total[5m])) by (route, result)` |

---

## 3. ชุด Query แนะนำสำหรับ Dashboard (คัดมาแล้ว)

คัดมาให้ใช้เป็น Panel ใน Dashboard ได้เลย (เวลา range ปกติใช้ `[5m]` หรือ `[1m]` ตามความละเอียด)

```promql
# Panel 1: Request rate (req/s) — แยก source
sum(rate(alertbridge_requests_total[5m])) by (source)

# Panel 2: Request rate (req/s) — แยก route
sum(rate(alertbridge_requests_total[5m])) by (route)

# Panel 3: Total requests (ล่าสุด)
sum(alertbridge_requests_total)

# Panel 4: Forward success vs fail (อัตราต่อวินาที)
sum(rate(alertbridge_forward_total[5m])) by (result)

# Panel 5: Forward ต่อ route (อัตราต่อวินาที)
sum(rate(alertbridge_forward_total[5m])) by (route, result)

# Panel 6: Forward latency p99 (วินาที)
histogram_quantile(0.99, sum(rate(alertbridge_forward_latency_seconds_bucket[5m])) by (le, route))

# Panel 7: Forward latency เฉลี่ย (วินาที)
sum(rate(alertbridge_forward_latency_seconds_sum[5m])) by (route) / sum(rate(alertbridge_forward_latency_seconds_count[5m])) by (route)

# Panel 8: Config reload (รวม)
sum(alertbridge_config_reload_total) by (result)

# Panel 9: HMAC verify (รวม แยก result)
sum(alertbridge_hmac_verify_total) by (route, result)

# Panel 10: Request ตาม HTTP status
sum(alertbridge_requests_total) by (status)
```

---

## 4. สรุปชื่อเมตริกทั้งหมด (สำหรับ Copy ไปใช้)

```
alertbridge_requests_total
alertbridge_forward_total
alertbridge_forward_latency_seconds
alertbridge_forward_latency_seconds_bucket
alertbridge_forward_latency_seconds_count
alertbridge_forward_latency_seconds_sum
alertbridge_config_reload_total
alertbridge_hmac_verify_total
```

---

## 5. หมายเหตุสำหรับ OCP Observe

- เลือก **Project: alertbridge** (หรือ scope ที่ UWM scrape จาก namespace นี้) เพื่อให้เห็นเมตริกของ AlertBridge
- ถ้าไม่มี series ลองไม่ใส่ project filter หรือขยาย time range
- ค่า `[5m]` ใน `rate()` ใช้ปรับได้ (เช่น `[1m]`, `[15m]`) ตามความละเอียดที่ต้องการ
