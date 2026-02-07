const express = require('express');
const router = express.Router();
const { ocpPayload, confluentPayload } = require('../lib/payloads');

const getPayload = (pattern, overrides) => {
  switch (pattern) {
    case 'ocp':
      return ocpPayload(overrides);
    case 'confluent':
      return confluentPayload(overrides);
    default:
      return ocpPayload(overrides);
  }
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * POST /api/send
 * Body: { pattern, targets: [ { name, url, apiKey? } ], count?: number, eps?: number }
 * count = จำนวน alert ที่ยิง (default 1)
 * eps = events per second (default 0 = ส่งเร็วสุด ไม่หน่วง)
 * apiKey = API Key สำหรับ Authentication (ส่งใน Header: Authorization: Bearer <key>)
 * Information ใน payload สุ่มทุกครั้ง
 */
router.post('/send', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    let payloadUsed = null;
    const count = Math.max(1, Math.min(Number(req.body.count) || 1, 10000));
    const eps = Math.max(0, Number(req.body.eps) || 0);
    const pattern = req.body.pattern === 'confluent' ? 'confluent' : 'ocp';
    const targets = Array.isArray(req.body.targets) ? req.body.targets : [];

    if (!targets.length) {
      return res.status(400).send(JSON.stringify({ error: 'At least one target is required.' }));
    }

    const results = [];
    const delayMs = eps > 0 ? 1000 / eps : 0;

    const overrides = req.body.overrides || {};
    const hasOverrides = Object.keys(overrides).length > 0;

    for (let i = 0; i < count; i++) {
      const payload = getPayload(pattern, hasOverrides ? overrides : undefined);
      if (!payloadUsed) payloadUsed = payload;

      for (const t of targets) {
        let url = (t.url || '').trim();
        if (!url) continue;
        // ตรวจสอบว่า URL ถูกต้อง (ต้องมี http:// หรือ https://)
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          results.push({
            batch: i + 1,
            name: t.name || url,
            url,
            success: false,
            error: `Invalid URL: URL must start with http:// or https://. Got: ${url.substring(0, 50)}...`,
          });
          continue;
        }
        // Normalize URL: แก้ double slash (//) และ trailing slash
        url = url.replace(/([^:]\/)\/+/g, '$1'); // แก้ // เป็น / แต่ไม่เปลี่ยน http://
        if (url.endsWith('/') && url.length > 1) {
          url = url.slice(0, -1); // ลบ trailing slash
        }
        try {
          const headers = { 'Content-Type': 'application/json' };
          // รับ API Key - รองรับทั้ง string และ null/undefined
          const apiKeyRaw = t.apiKey;
          const apiKey = (apiKeyRaw && typeof apiKeyRaw === 'string') ? apiKeyRaw.trim() : '';
          const authType = (t.authType || 'bearer').toLowerCase();
          
          if (apiKey && apiKey.length > 0) {
            if (authType === 'x-api-key' || authType === 'x_api_key') {
              headers['X-API-Key'] = apiKey;
            } else {
              // Default: Bearer token
              headers['Authorization'] = `Bearer ${apiKey}`;
            }
          }
          // Debug: log headers ที่ส่ง (ไม่ log API Key เต็มเพื่อความปลอดภัย)
          const debugHeaders = { ...headers };
          if (debugHeaders['X-API-Key']) {
            debugHeaders['X-API-Key'] = debugHeaders['X-API-Key'].substring(0, 8) + '...';
          }
          if (debugHeaders['Authorization']) {
            debugHeaders['Authorization'] = 'Bearer ' + debugHeaders['Authorization'].replace('Bearer ', '').substring(0, 8) + '...';
          }
          console.log(`[Send] ${url} | Headers:`, JSON.stringify(debugHeaders));
          console.log(`[Send] API Key present: ${!!apiKey}, Auth Type: ${authType}, Key length: ${apiKey ? apiKey.length : 0}`);
          const r = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
          });
          let responseBody = '';
          try {
            responseBody = await r.text();
          } catch {}
          if (!r.ok) {
            console.log(`[Send] Error ${r.status} ${r.statusText} | Response:`, responseBody.substring(0, 300));
          }
          results.push({
            batch: i + 1,
            name: t.name || url,
            url,
            success: r.ok,
            status: r.status,
            statusText: r.statusText,
            responseBody: responseBody ? responseBody.substring(0, 500) : undefined,
            hasApiKey: !!apiKey,
            authType: apiKey ? authType : 'none',
            sentHeaders: debugHeaders, // เพิ่ม headers ที่ส่งไปเพื่อ debug
          });
        } catch (err) {
          results.push({
            batch: i + 1,
            name: t.name || url,
            url,
            success: false,
            error: err.message || String(err),
          });
        }
      }

      if (delayMs > 0 && i < count - 1) await delay(delayMs);
    }

    const body = {
      payload: payloadUsed,
      usedOverrides: hasOverrides,
      overrides: hasOverrides ? overrides : undefined,
      count,
      eps,
      totalSent: results.length,
      results,
    };
    res.send(JSON.stringify(body));
  } catch (err) {
    res.status(500).send(JSON.stringify({ error: err.message || String(err) }));
  }
});

/**
 * GET /api/payload?pattern=ocp|confluent
 */
router.get('/payload', (req, res) => {
  const pattern = req.query.pattern === 'confluent' ? 'confluent' : 'ocp';
  const payload = getPayload(pattern);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(payload));
});

/**
 * POST /api/payload/preview
 * Body: { pattern, overrides? } - ส่งกลับ payload ที่จะยิง (รวม manual values)
 */
router.post('/payload/preview', (req, res) => {
  const pattern = req.body.pattern === 'confluent' ? 'confluent' : 'ocp';
  const overrides = req.body.overrides || {};
  const payload = getPayload(pattern, Object.keys(overrides).length ? overrides : undefined);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(payload));
});

module.exports = router;
