/**
 * UI i18n: EN / TH. User preference stored in localStorage.
 */
const LANG = {
  en: {
    liveEvents: "Live Events (Incoming Webhooks)",
    liveEventsSub: "Last 20 webhooks · refreshes every 1.5s · Use these for Field Mapper",
    liveEmpty: "No webhooks yet. POST to",
    orSource: "or other configured source",
    webhookEndpoints: "Webhook Endpoints (Alert Receivers)",
    webhookSub: "Routes available — Clients can POST to",
    noRoutes: "No routes configured. Add routes in Config (YAML) below.",
    clientInfo: "Client Info (for sending alerts)",
    clientSendTo: "Clients must POST to:",
    apiKeyRequired: "API Key required! Clients must send API Key:",
    method1: "Method 1:",
    method2: "Method 2:",
    apiKeysAvailable: "Available API keys:",
    copyFromSection: "Copy API Key from API Keys section above",
    noApiKey: "API Key not required (disabled)",
    requestFormat: "Request Format",
    bodyFormat: "Body: JSON payload per source format (OCP/Confluent/etc.)",
    troubleshooting: "Common Issues",
    t401: "401 Unauthorized: Must send API Key (see Authentication above)",
    t404: "404 Not Found: Verify source in URL matches configured routes",
    tConnRefused: "Connection refused: 127.0.0.1 from another host will fail; use real server IP",
    tInvalidJson: "Invalid JSON: Verify body is valid JSON",
    targetUrls: "Target URLs & API Keys (Forward Out)",
    targetUrlsSub: "Set URL and API Key for forwarding alerts to target.",
    apiKeyHeader: "API Key Header (forward out):",
    noApiKeyOpt: "— No API Key —",
    apiKeyValue: "API Key Value:",
    apiKeyPlaceholder: "API Key or env var (e.g. TARGET_API_KEY_OCP)",
    orEnvVar: "Or Env Var:",
    sourceModes: "Source pattern options:",
    fromLive: "From live traffic — Select payload below \"From live traffic\", then Use as source fields",
    manual: "Manual — Select template (OCP/Confluent) or \"Custom (paste example log)\" and paste JSON",
    targetTitle: "Target (output) — from example log",
    targetDesc: "Upload or paste one example log (JSON) of the format you want to send. Parsed into fields for mapping.",
    mode1: "Option 1 — From live traffic (recommended)",
    mode1Steps: "Steps: 1) Check Live Events above for incoming sources 2) Select payload below 3) Use as source fields 4) Map to Target 5) Save as pattern",
    tip: "Tip: If no Live Events, send test webhook to",
    first: "first (see Routes above)",
    saveTargetUrls: "Save target URLs & API Keys",
    copyNow: "Copy now — this key is shown only once.",
    failedEvents: "Failed Events (Forward did not succeed)",
    failedEventsSub: "Display 20 · up to 200 stored (search all) · in-memory only (lost on restart)",
    failedSearchPlaceholder: "Search: source, route, request_id...",
    failedEmpty: "No failed events. Forward failures will appear here.",
    noMatchesForSearch: "No matches for search",
    targetFwdChecking: "Target Fwd: Checking…",
    targetFwdOnline: "Target Fwd: Online",
    targetFwdOffline: "Target Fwd: Offline",
    targetOk: "●",
    targetFail: "●",
  },
  th: {
    liveEvents: "Live Events (Webhooks ที่เข้ามา)",
    liveEventsSub: "20 รายการล่าสุด · รีเฟรชทุก 1.5 วินาที · ใช้ Live Events เหล่านี้สร้าง Pattern ได้",
    liveEmpty: "ยังไม่มี webhooks เข้ามา. ส่ง POST มาที่",
    orSource: "หรือ source อื่นที่ configure ไว้",
    webhookEndpoints: "Webhook Endpoints (ช่องทางการรับ Alert)",
    webhookSub: "Routes ที่เปิดอยู่ — Clients สามารถส่ง POST มาที่",
    noRoutes: "ยังไม่มี routes configured. เพิ่ม routes ใน Config (YAML) ด้านล่าง",
    clientInfo: "ข้อมูลสำหรับ Client ที่จะส่ง Alert มา",
    clientSendTo: "Client ต้องส่ง POST request มาที่:",
    apiKeyRequired: "API Key จำเป็นต้องมี! Client ต้องส่ง API Key มาด้วย:",
    method1: "วิธีที่ 1:",
    method2: "วิธีที่ 2:",
    apiKeysAvailable: "API Keys ที่มีอยู่:",
    copyFromSection: "Copy API Key จากส่วน \"API Keys\" ด้านบน",
    noApiKey: "ไม่ต้องใช้ API Key (ยังไม่ได้เปิดใช้งาน)",
    requestFormat: "Request Format",
    bodyFormat: "Body: JSON payload ตาม format ของ source (OCP/Confluent/etc.)",
    troubleshooting: "ปัญหาที่พบบ่อย",
    t401: "401 Unauthorized: ต้องส่ง API Key มาด้วย (ดู Authentication ด้านบน)",
    t404: "404 Not Found: ตรวจสอบว่า source ใน URL ตรงกับ routes ที่ configure ไว้",
    tConnRefused: "Connection refused: ถ้าใช้ 127.0.0.1 จากเครื่องอื่นจะยิงไม่ได้ ต้องใช้ IP จริงของ server",
    tInvalidJson: "Invalid JSON: ตรวจสอบว่า body เป็น JSON ที่ถูกต้อง",
    targetUrls: "Target URLs & API Keys (ขา Forward)",
    targetUrlsSub: "ตั้งค่า URL และ API Key สำหรับส่ง Alert ไปที่ปลายทาง (forward side).",
    apiKeyHeader: "API Key Header (ขา Forward):",
    noApiKeyOpt: "— ไม่ใช้ API Key —",
    apiKeyValue: "API Key Value:",
    apiKeyPlaceholder: "ใส่ API Key หรือใช้ env var (เช่น TARGET_API_KEY_OCP)",
    orEnvVar: "หรือใช้ Env Var:",
    sourceModes: "Source pattern ได้ 2 แบบ:",
    fromLive: "จับจาก Live Traffic — เลือก payload ด้านล่าง \"From live traffic\" แล้วกด Use as source fields",
    manual: "กำหนดเอง (Manual) — เลือก template (OCP/Confluent) หรือ \"Custom (paste example log)\" แล้ววาง JSON เอง",
    targetTitle: "Target (ปลายทาง) — from example log",
    targetDesc: "Upload or paste one example log (JSON) of the format you want to send to the target. It will be parsed into fields for mapping.",
    mode1: "แบบที่ 1 — From live traffic (แนะนำ)",
    mode1Steps: "ขั้นตอน: 1) ดู Live Events ด้านบนว่ามี source อะไรเข้ามา 2) เลือก payload ที่ต้องการจากรายการด้านล่าง 3) กด \"Use as source fields\" 4) Map กับ Target fields 5) Save as pattern",
    tip: "Tip: ถ้ายังไม่มี Live Events ให้ส่ง test webhook มาที่",
    first: "ก่อน (ดู Routes ด้านบน)",
    saveTargetUrls: "Save target URLs & API Keys",
    copyNow: "Copy now — this key is shown only once.",
    failedEvents: "Failed Events (ส่งไปไม่ได้)",
    failedEventsSub: "แสดง 20 รายการ · เก็บสูงสุด 200 (ค้นหาทั้งหมดได้) · เก็บใน memory เท่านั้น (หายเมื่อ restart)",
    failedSearchPlaceholder: "ค้นหา: source, route, request_id...",
    failedEmpty: "ยังไม่มีรายการล้มเหลว. เมื่อ forward ล้มเหลวจะปรากฏที่นี่",
    noMatchesForSearch: "ไม่พบผลลัพธ์จากคำค้น",
    targetFwdChecking: "Target Fwd: กำลังตรวจสอบ…",
    targetFwdOnline: "Target Fwd: Online",
    targetFwdOffline: "Target Fwd: Offline",
    targetOk: "●",
    targetFail: "●",
  },
};

let currentLang = (typeof localStorage !== "undefined" && localStorage.getItem("alertbridge_lang")) || "en";

function t(key) {
  const lang = LANG[currentLang] || LANG.en;
  return lang[key] || LANG.en[key] || key;
}

function setLang(lang) {
  if (LANG[lang]) {
    currentLang = lang;
    if (typeof localStorage !== "undefined") localStorage.setItem("alertbridge_lang", lang);
    applyI18n();
  }
}

function getLang() {
  return currentLang;
}

function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key);
  });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const key = el.getAttribute("data-i18n-html");
    if (key) el.innerHTML = t(key);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key) el.placeholder = t(key);
  });
  const enBtn = document.getElementById("langEn");
  const thBtn = document.getElementById("langTh");
  if (enBtn) enBtn.setAttribute("aria-pressed", currentLang === "en");
  if (thBtn) thBtn.setAttribute("aria-pressed", currentLang === "th");
  if (typeof window.onLangChange === "function") window.onLangChange();
}

if (typeof window !== "undefined") {
  window.t = t;
  window.setLang = setLang;
  window.getLang = getLang;
  window.applyI18n = applyI18n;
}
