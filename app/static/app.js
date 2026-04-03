const routesList = document.getElementById("routesList");
const configTextarea = document.getElementById("configTextarea");
const saveBtn = document.getElementById("saveBtn");
const reloadBtn = document.getElementById("reloadBtn");
const configStatus = document.getElementById("configStatus");
const sourceSelect = document.getElementById("sourceSelect");
const sampleTextarea = document.getElementById("sampleTextarea");
const previewBtn = document.getElementById("previewBtn");
const previewStatus = document.getElementById("previewStatus");
const previewOutput = document.getElementById("previewOutput");
const statsTotal = document.getElementById("statsTotal");
const statsBySource = document.getElementById("statsBySource");
const statsForwardOk = document.getElementById("statsForwardOk");
const statsForwardFail = document.getElementById("statsForwardFail");
const statsStatus = document.getElementById("statsStatus");
const liveRequestsBody = document.getElementById("liveRequestsBody");
const liveRequestsEmpty = document.getElementById("liveRequestsEmpty");
const failedEventsBody = document.getElementById("failedEventsBody");
const failedEventsEmpty = document.getElementById("failedEventsEmpty");
const failedEventsSearch = document.getElementById("failedEventsSearch");
const heartbeatChart = document.getElementById("heartbeatChart");
const heartbeatLabel = document.getElementById("heartbeatLabel");
const targetUrlsPanel = document.getElementById("targetUrlsPanel");
const targetUrlsEffective = document.getElementById("targetUrlsEffective");
const saveTargetUrlsBtn = document.getElementById("saveTargetUrlsBtn");
const targetUrlsStatus = document.getElementById("targetUrlsStatus");
const mapperSourceType = document.getElementById("mapperSourceType");
const mapperPatternName = document.getElementById("mapperPatternName");
const mapperSourceDescription = document.getElementById("mapperSourceDescription");
const mapperSourceFields = document.getElementById("mapperSourceFields");
const mapperMappingBody = document.getElementById("mapperMappingBody");
const mapperSavePatternBtn = document.getElementById("mapperSavePatternBtn");
const mapperLoadPatternBtn = document.getElementById("mapperLoadPatternBtn");
const mapperApplySavedToRouteBtn = document.getElementById("mapperApplySavedToRouteBtn");
const mapperApplyRoute = document.getElementById("mapperApplyRoute");
const mapperApplyBtn = document.getElementById("mapperApplyBtn");
const mapperStatus = document.getElementById("mapperStatus");
const savedPatternsList = document.getElementById("savedPatternsList");
const mapperLoadPatternSelect = document.getElementById("mapperLoadPatternSelect");
const mapperTargetExample = document.getElementById("mapperTargetExample");
const mapperTargetFile = document.getElementById("mapperTargetFile");
const mapperParseTargetBtn = document.getElementById("mapperParseTargetBtn");
const mapperTargetPatternStatus = document.getElementById("mapperTargetPatternStatus");
const mapperSourceCustomWrap = document.getElementById("mapperSourceCustomWrap");
const mapperParseSourceBtn = document.getElementById("mapperParseSourceBtn");
const statusIncoming = document.getElementById("statusIncoming");
const statusIncomingText = document.getElementById("statusIncomingText");
const statusForward = document.getElementById("statusForward");
const statusForwardText = document.getElementById("statusForwardText");
const statusDlq = document.getElementById("statusDlq");
const statusDlqText = document.getElementById("statusDlqText");
const recentPayloadsList = document.getElementById("recentPayloadsList");
const recentPayloadsStatus = document.getElementById("recentPayloadsStatus");
const recentSentList = document.getElementById("recentSentList");
const recentSentStatus = document.getElementById("recentSentStatus");
const apiKeyNameInput = document.getElementById("apiKeyNameInput");
const genApiKeyBtn = document.getElementById("genApiKeyBtn");
const apiKeysStatus = document.getElementById("apiKeysStatus");
const apiKeyNewKeyBox = document.getElementById("apiKeyNewKeyBox");
const apiKeyNewKeyValue = document.getElementById("apiKeyNewKeyValue");
const apiKeyCopyBtn = document.getElementById("apiKeyCopyBtn");
const apiKeysList = document.getElementById("apiKeysList");
let recentPayloadsCache = [];
let failedEventsCache = [];
let liveRequestsCache = [];
let targetsCache = [];
let targetStatusCache = { routes: [] };
let dlqEntriesCache = [];
let dlqOpenDetailIndex = null;
/** @type {Set<string>} Selected dlq_id values for bulk purge */
let dlqSelectedIds = new Set();
let livePage = 1;
let failedPage = 1;
let dlqPage = 1;

const DLQ_TABLE_COLS = 8;

/** Stable key for checkbox + purge API: dlq_id, or request_id for legacy rows without dlq_id. */
function dlqPurgeKey(e) {
  if (e.dlq_id) return String(e.dlq_id);
  if (e.request_id) return String(e.request_id);
  return "";
}

function dlqPageSize() {
  const n = Number(document.getElementById("dlqLimit")?.value);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

function tr(key) {
  const fn = (typeof window !== "undefined" && window.t) ? window.t : (k => k);
  return fn(key);
}

function fmtPatternTime(ts) {
  if (!ts) return "";
  const s = String(ts);
  return s.replace("T", " ").replace("+07:00", " GMT+7");
}

const RATE_HISTORY_MAX = 90;
let patternSchemas = { source_schemas: {}, target_fields: [] };
/** Max source path options (Option 1…N) per target row. */
const MAPPER_MAX_SRC_OPTS = 12;
/** Max separate JSON sample rows in Custom source (paths merged for dropdowns). */
const MAPPER_MAX_SOURCE_JSON_ROWS = 8;
/** Preset combine templates: {0}=Source col 1, {1}=col 2, … — pick from UI to avoid typos. */
const MAPPER_CONCAT_PRESETS = [
  { id: "", template: null, labelKey: "mapperConcatPresetNone" },
  { id: "b01", template: "[{0}] {1}", labelKey: "mapperConcatPresetBracket01" },
  { id: "c01", template: "{0}: {1}", labelKey: "mapperConcatPresetColon01" },
  { id: "p01", template: "{0} | {1}", labelKey: "mapperConcatPresetPipe01" },
  { id: "s01", template: "{0} {1}", labelKey: "mapperConcatPresetSpace01" },
  { id: "b012", template: "[{0}] {1} {2}", labelKey: "mapperConcatPresetBracket012" },
  { id: "nl01", template: "{0}\n{1}", labelKey: "mapperConcatPresetNewline01" },
  { id: "custom", template: null, labelKey: "mapperConcatPresetCustom" },
];
let targetFieldsFromUpload = [];
let customSourceFields = [];
let mapperMergeListenersAttached = false;
let rateHistory = [];
let lastTotalRequests = null;
let configJson = null;
/** In-cluster webhook base from GET /api/in-cluster-webhook-base (HTTP Service URL). */
let internalWebhookBase = null;
/** When set, Save/Apply update this saved pattern row (overwrite / rename) instead of creating duplicates. */
let editorPatternId = null;

/** Parse JSON into list of paths for mapping. Returns [ { id, label }, ... ]. Handles nested objects; for arrays uses first element. */
function parseJsonToPaths(obj, prefix = "") {
  const out = [];
  if (obj === null || typeof obj !== "object") return out;
  if (Array.isArray(obj)) {
    if (obj.length === 0) return out;
    return parseJsonToPaths(obj[0], prefix ? `${prefix}.0` : "0");
  }
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    const path = prefix ? `${prefix}.${key}` : key;
    out.push({ id: path, label: path });
    if (val !== null && typeof val === "object") {
      out.push(...parseJsonToPaths(val, path));
    }
  }
  return out;
}

/** Stable sort for custom-paste path list — same tier order as preset dropdowns. */
function mapperSortFieldList(list) {
  if (!list || !list.length) return [];
  return [...list]
    .map((f) => ({ id: f.id, label: f.label || f.id }))
    .sort((a, b) => {
      const ra = mapperSourceFieldDisplayRank(a.id);
      const rb = mapperSourceFieldDisplayRank(b.id);
      if (ra !== rb) return ra - rb;
      return String(a.id).localeCompare(String(b.id));
    });
}

function mapperBuildSourceJsonRowElement(initialValue = "") {
  const row = document.createElement("div");
  row.className = "mapper-source-json-row";
  const lab = document.createElement("span");
  lab.className = "mapper-source-json-row-label";
  const ta = document.createElement("textarea");
  ta.className = "textarea mapper-paste-json-small mapper-source-json-ta";
  ta.rows = 4;
  ta.placeholder = tr("mapperSourceJsonPlaceholder");
  ta.value = initialValue;
  const act = document.createElement("div");
  act.className = "mapper-source-json-row-actions";
  const rm = document.createElement("button");
  rm.type = "button";
  rm.className = "btn btn-secondary btn-compact mapper-remove-json-row";
  rm.textContent = "−";
  act.appendChild(rm);
  row.appendChild(lab);
  row.appendChild(ta);
  row.appendChild(act);
  return row;
}

function mapperSyncSourceJsonRowLabels() {
  const wrap = document.getElementById("mapperSourceJsonRows");
  if (!wrap) return;
  const rows = wrap.querySelectorAll(".mapper-source-json-row");
  const n = rows.length;
  rows.forEach((row, i) => {
    const lab = row.querySelector(".mapper-source-json-row-label");
    if (lab) lab.textContent = tr("mapperJsonSampleLabel").replace("{n}", String(i + 1));
    const ta = row.querySelector(".mapper-source-json-ta");
    if (ta) ta.placeholder = tr("mapperSourceJsonPlaceholder");
    const rm = row.querySelector(".mapper-remove-json-row");
    if (rm) {
      rm.disabled = n <= 1;
      const a = tr("mapperRemoveJsonSampleAria");
      rm.setAttribute("aria-label", a);
      rm.title = a;
    }
  });
}

function mapperUpdateAddJsonRowBtnState() {
  const wrap = document.getElementById("mapperSourceJsonRows");
  const addBtn = document.getElementById("mapperAddSourceJsonRowBtn");
  if (!wrap || !addBtn) return;
  const n = wrap.querySelectorAll(".mapper-source-json-row").length;
  addBtn.disabled = n >= MAPPER_MAX_SOURCE_JSON_ROWS;
}

function mapperResetSourceJsonRowsToSingle(jsonPretty) {
  const wrap = document.getElementById("mapperSourceJsonRows");
  if (!wrap) return;
  wrap.innerHTML = "";
  wrap.appendChild(mapperBuildSourceJsonRowElement(jsonPretty || ""));
  mapperSyncSourceJsonRowLabels();
  mapperUpdateAddJsonRowBtnState();
}

function mapperAppendSourceJsonRow(prefill = "") {
  const wrap = document.getElementById("mapperSourceJsonRows");
  if (!wrap) return;
  if (wrap.querySelectorAll(".mapper-source-json-row").length >= MAPPER_MAX_SOURCE_JSON_ROWS) return;
  wrap.appendChild(mapperBuildSourceJsonRowElement(prefill));
  mapperSyncSourceJsonRowLabels();
  mapperUpdateAddJsonRowBtnState();
}

function mapperCollectParsedListsFromSourceJsonRows() {
  const wrap = document.getElementById("mapperSourceJsonRows");
  if (!wrap) return { errors: [], lists: [] };
  const tas = wrap.querySelectorAll(".mapper-source-json-ta");
  const errors = [];
  const lists = [];
  tas.forEach((ta, i) => {
    const s = ta.value.trim();
    if (!s) return;
    try {
      const data = JSON.parse(s);
      lists.push(parseJsonToPaths(data));
    } catch (e) {
      const lab = tr("mapperJsonSampleLabel").replace("{n}", String(i + 1));
      errors.push(`${lab}: ${e.message}`);
    }
  });
  return { errors, lists };
}

function mapperApplyParsedSourceFieldsFromRows() {
  const { errors, lists } = mapperCollectParsedListsFromSourceJsonRows();
  if (errors.length) {
    if (mapperStatus) mapperStatus.textContent = errors.join("; ");
    return;
  }
  if (lists.length === 0) {
    customSourceFields = [];
    onMapperSourceTypeChange();
    if (mapperStatus) mapperStatus.textContent = tr("mapperParseSourceEmptyRows");
    return;
  }
  customSourceFields = mapperSortFieldList(lists[0]);
  onMapperSourceTypeChange();
  const nf = customSourceFields.length;
  const msg = lists.length === 1
    ? tr("mapperParsedSingleSample").replace("{n}", String(nf))
    : tr("mapperParsedFirstSampleOnly").replace("{n}", String(nf)).replace("{r}", String(lists.length));
  if (mapperStatus) mapperStatus.textContent = msg;
}

async function loadHeaderVersion() {
  const el = document.getElementById("headerVersion");
  if (!el) return;
  try {
    const res = await fetch("/version", { credentials: "include" });
    if (!res.ok) return;
    const data = await res.json();
    const v = data.version;
    const ns = data.namespace;
    const site = data.site;
    document.title = site ? `AlertBridge-${String(site)}` : "AlertBridge";
    if (v) {
      const plain = [`v${v}`, site ? `site:${site}` : null, ns ? `ns:${ns}` : null].filter(Boolean).join(" · ");
      el.setAttribute("aria-label", plain);
      const bits = [`<span class="header-ver-part">${escapeHtml(`v${v}`)}</span>`];
      if (site) {
        bits.push(
          `<span class="header-site-badge">${escapeHtml(`site:${site}`)}</span>`,
        );
      }
      if (ns) bits.push(`<span class="header-ver-part">${escapeHtml(`ns:${ns}`)}</span>`);
      el.innerHTML = bits.join('<span class="header-ver-sep"> · </span>');
    }
  } catch (_) {}
}

async function loadConfig() {
  configStatus.textContent = "Loading...";
  try {
    const [yamlRes, jsonRes, hintsRes] = await Promise.all([
      fetch("/api/config", { headers: { Accept: "text/yaml" }, credentials: "include" }),
      fetch("/api/config", { credentials: "include" }),
      fetch("/api/in-cluster-webhook-base", { credentials: "include" }),
    ]);

    if (!yamlRes.ok || !jsonRes.ok) {
      throw new Error("Failed to load config");
    }

    try {
      if (hintsRes.ok) {
        const hints = await hintsRes.json();
        internalWebhookBase = hints.internal_webhook_base || null;
      } else {
        internalWebhookBase = null;
      }
    } catch {
      internalWebhookBase = null;
    }

    const yamlText = await yamlRes.text();
    configTextarea.value = yamlText;

    const jsonData = await jsonRes.json();
    configJson = JSON.parse(JSON.stringify(jsonData));
    renderRoutes(jsonData.routes || []);
    renderTargetUrls(jsonData.routes || []);
    renderMapperApplyRoutes(jsonData.routes || []);
    loadActiveRouteMappingIntoForm();
    await loadEffectiveTargets();
    configStatus.textContent = "Loaded";
  } catch (error) {
    configStatus.textContent = `Error: ${error.message}`;
  } finally {
    try {
      await loadSavedPatterns();
    } catch (_) {}
  }
}

function renderTargetUrlsEffective(targets, statusByRoute) {
  if (!targetUrlsEffective) return;
  if (!Array.isArray(targets) || !targets.length) {
    targetUrlsEffective.innerHTML = "<span class=\"not-set\">No routes or targets not loaded.</span>";
    return;
  }
  const statusMap = {};
  if (statusByRoute && statusByRoute.length) {
    statusByRoute.forEach((s) => { statusMap[s.route] = s; });
  }
  targetUrlsEffective.innerHTML = "<strong>Server will forward to:</strong><br>" + targets.map((r) => {
    const cls = (r.target_url === "(not set)") ? "not-set" : "effective-url";
    const st = statusMap[r.route];
    let badge = "";
    if (st && st.forward_paused) {
      badge = ` <span class="target-status-badge target-paused" title="${escapeHtml(tr("forwardPaused"))}">${escapeHtml(tr("forwardPausedBadge"))}</span>`;
    } else if (st && r.target_url !== "(not set)") {
      const ok = st.phase1_ok && st.phase2_ok;
      const errText = st.error ? ` <span class="target-status-err">${escapeHtml(st.error)}</span>` : "";
      badge = ` <span class="target-status-badge ${ok ? "target-ok" : "target-fail"}" title="${escapeHtml(st.error || "")}">${ok ? tr("targetOk") : tr("targetFail")}</span>${errText}`;
    }
    return `<span class="effective-row">${escapeHtml(r.route)} → <span class="${cls}">${escapeHtml(r.target_url)}</span>${badge}</span>`;
  }).join("<br>");
}

async function loadEffectiveTargets() {
  if (!targetUrlsEffective) return;
  try {
    const response = await fetch("/api/config/targets", { credentials: "include" });
    if (!response.ok) return;
    const data = await response.json();
    targetsCache = Array.isArray(data) ? data : [];
    renderTargetUrlsEffective(targetsCache, targetStatusCache.routes);
  } catch (err) {
    targetUrlsEffective.textContent = "";
  }
}

async function persistRouteForwardEnabled(routeName, enabled, checkboxEl) {
  if (!configJson || !configJson.routes) return;
  const route = configJson.routes.find((x) => x.name === routeName);
  if (route) route.forward_enabled = enabled;
  if (targetUrlsStatus) targetUrlsStatus.textContent = tr("saving");
  try {
    const response = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(configJson),
      credentials: "include",
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || "Save failed");
    }
    const reloadRes = await fetch("/admin/reload", { method: "POST", credentials: "include" });
    if (!reloadRes.ok) {
      throw new Error("Reload failed");
    }
    if (targetUrlsStatus) {
      targetUrlsStatus.textContent = enabled ? tr("forwardResumed") : tr("forwardPaused");
    }
    await loadPortalStatus();
    await loadEffectiveTargets();
    await loadConfig();
  } catch (error) {
    if (targetUrlsStatus) targetUrlsStatus.textContent = `Error: ${error.message}`;
    if (checkboxEl) checkboxEl.checked = !enabled;
  }
}

function renderTargetUrls(routes) {
  if (!targetUrlsPanel) return;
  targetUrlsPanel.innerHTML = "";
  if (!routes.length) return;
  routes.forEach((route) => {
    const routeName = route.name;
    const source = route.match?.source || "";
    
    // Main row container
    const routeContainer = document.createElement("div");
    routeContainer.className = "target-route-container";
    
    // Route header
    const header = document.createElement("div");
    header.className = "target-route-header";
    header.innerHTML = `<strong>${escapeHtml(routeName)}</strong> <span class="text-muted">(${escapeHtml(source)})</span>`;
    routeContainer.appendChild(header);

    const fwdRow = document.createElement("div");
    fwdRow.className = "target-forward-toggle-row";
    const fwdLabel = document.createElement("label");
    fwdLabel.className = "target-forward-label";
    fwdLabel.textContent = tr("forwardingEnabled");
    const fwdCheck = document.createElement("input");
    fwdCheck.type = "checkbox";
    fwdCheck.checked = route.forward_enabled !== false;
    fwdCheck.setAttribute("data-route-name", routeName);
    fwdCheck.setAttribute("data-field", "forward_enabled");
    fwdCheck.addEventListener("change", () => {
      persistRouteForwardEnabled(routeName, fwdCheck.checked, fwdCheck);
    });
    const fwdHint = document.createElement("span");
    fwdHint.className = "text-muted target-forward-hint";
    fwdHint.textContent = tr("forwardingHint");
    fwdRow.appendChild(fwdLabel);
    fwdRow.appendChild(fwdCheck);
    fwdRow.appendChild(fwdHint);
    routeContainer.appendChild(fwdRow);
    
    // URL row
    const urlRow = document.createElement("div");
    urlRow.className = "target-url-row";
    const urlLabel = document.createElement("label");
    urlLabel.textContent = "Target URL:";
    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.placeholder = "http://127.0.0.1:9999/webhook";
    urlInput.value = route.target?.url || "";
    urlInput.setAttribute("data-route-name", routeName);
    urlInput.setAttribute("data-field", "url");
    urlRow.appendChild(urlLabel);
    urlRow.appendChild(urlInput);
    routeContainer.appendChild(urlRow);
    
    // API Key Header row
    const apiKeyHeaderRow = document.createElement("div");
    apiKeyHeaderRow.className = "target-api-key-header-row";
    const apiKeyLabel = document.createElement("label");
    apiKeyLabel.textContent = tr("apiKeyHeader");
    apiKeyHeaderRow.appendChild(apiKeyLabel);
    const headerSelect = document.createElement("select");
    headerSelect.className = "select target-api-key-header-select";
    headerSelect.setAttribute("data-route-name", routeName);
    headerSelect.setAttribute("data-field", "api_key_header");
    headerSelect.innerHTML = `
      <option value="">${tr("noApiKeyOpt")}</option>
      <option value="X-API-Key" ${route.target?.api_key_header === "X-API-Key" ? "selected" : ""}>X-API-Key</option>
      <option value="Authorization" ${route.target?.api_key_header === "Authorization" ? "selected" : ""}>Authorization (Bearer)</option>
      <option value="X-Auth-Token" ${route.target?.api_key_header === "X-Auth-Token" ? "selected" : ""}>X-Auth-Token</option>
    `;
    apiKeyHeaderRow.appendChild(headerSelect);
    routeContainer.appendChild(apiKeyHeaderRow);
    
    // API Key Value row (show only if header is selected)
    const apiKeyValueRow = document.createElement("div");
    apiKeyValueRow.className = "target-api-key-value-row";
    apiKeyValueRow.style.display = route.target?.api_key_header ? "flex" : "none";
    const apiKeyValueLabel = document.createElement("label");
    apiKeyValueLabel.textContent = tr("apiKeyValue");
    const apiKeyValueWrap = document.createElement("div");
    apiKeyValueWrap.className = "target-api-key-value-wrap";
    const apiKeyValueInput = document.createElement("input");
    apiKeyValueInput.type = "password";
    apiKeyValueInput.placeholder = tr("apiKeyPlaceholder");
    apiKeyValueInput.value = route.target?.api_key || "";
    apiKeyValueInput.setAttribute("data-route-name", routeName);
    apiKeyValueInput.setAttribute("data-field", "api_key");
    apiKeyValueInput.autocomplete = "off";
    const apiKeyToggleBtn = document.createElement("button");
    apiKeyToggleBtn.type = "button";
    apiKeyToggleBtn.className = "btn btn-secondary target-api-key-toggle";
    apiKeyToggleBtn.title = "Show / Hide";
    apiKeyToggleBtn.textContent = "Show";
    apiKeyToggleBtn.addEventListener("click", () => {
      const isPass = apiKeyValueInput.type === "password";
      apiKeyValueInput.type = isPass ? "text" : "password";
      apiKeyToggleBtn.textContent = isPass ? "Hide" : "Show";
    });
    apiKeyValueWrap.appendChild(apiKeyValueInput);
    apiKeyValueWrap.appendChild(apiKeyToggleBtn);
    const apiKeyEnvLabel = document.createElement("label");
    apiKeyEnvLabel.className = "target-api-key-env-label";
    apiKeyEnvLabel.textContent = tr("orEnvVar");
    const apiKeyEnvInput = document.createElement("input");
    apiKeyEnvInput.type = "text";
    apiKeyEnvInput.placeholder = "TARGET_API_KEY_OCP";
    apiKeyEnvInput.value = route.target?.api_key_env || "";
    apiKeyEnvInput.setAttribute("data-route-name", routeName);
    apiKeyEnvInput.setAttribute("data-field", "api_key_env");
    apiKeyValueRow.appendChild(apiKeyValueLabel);
    apiKeyValueRow.appendChild(apiKeyValueWrap);
    apiKeyValueRow.appendChild(apiKeyEnvLabel);
    apiKeyValueRow.appendChild(apiKeyEnvInput);
    routeContainer.appendChild(apiKeyValueRow);
    
    // Show/hide API Key value row when header changes
    headerSelect.addEventListener("change", () => {
      apiKeyValueRow.style.display = headerSelect.value ? "flex" : "none";
    });

    // TLS row (for HTTPS targets)
    const tlsRow = document.createElement("div");
    tlsRow.className = "target-tls-row";
    const tlsLabel = document.createElement("label");
    tlsLabel.textContent = "TLS (HTTPS):";
    const tlsVerifyWrap = document.createElement("div");
    tlsVerifyWrap.className = "target-tls-verify-wrap";
    const tlsVerifySelect = document.createElement("select");
    tlsVerifySelect.className = "select target-tls-verify-select";
    tlsVerifySelect.setAttribute("data-route-name", routeName);
    tlsVerifySelect.setAttribute("data-field", "verify_tls");
    const verifyTls = route.target?.verify_tls;
    tlsVerifySelect.innerHTML = `
      <option value="" ${verifyTls === undefined || verifyTls === null || verifyTls === true ? "selected" : ""}>Verify (default)</option>
      <option value="false" ${verifyTls === false ? "selected" : ""}>Skip (self-signed)</option>
    `;
    const tlsCaLabel = document.createElement("label");
    tlsCaLabel.className = "target-tls-ca-label";
    tlsCaLabel.textContent = "CA cert path:";
    const tlsCaInput = document.createElement("input");
    tlsCaInput.type = "text";
    tlsCaInput.placeholder = "/path/to/ca.pem";
    tlsCaInput.value = route.target?.ca_cert || "";
    tlsCaInput.setAttribute("data-route-name", routeName);
    tlsCaInput.setAttribute("data-field", "ca_cert");
    const tlsCaEnvLabel = document.createElement("label");
    tlsCaEnvLabel.className = "target-tls-ca-env-label";
    tlsCaEnvLabel.textContent = "Or env var:";
    const tlsCaEnvInput = document.createElement("input");
    tlsCaEnvInput.type = "text";
    tlsCaEnvInput.placeholder = "TARGET_CA_CERT";
    tlsCaEnvInput.value = route.target?.ca_cert_env || "";
    tlsCaEnvInput.setAttribute("data-route-name", routeName);
    tlsCaEnvInput.setAttribute("data-field", "ca_cert_env");
    tlsVerifyWrap.appendChild(tlsVerifySelect);
    tlsRow.appendChild(tlsLabel);
    tlsRow.appendChild(tlsVerifyWrap);
    tlsRow.appendChild(tlsCaLabel);
    tlsRow.appendChild(tlsCaInput);
    tlsRow.appendChild(tlsCaEnvLabel);
    tlsRow.appendChild(tlsCaEnvInput);
    routeContainer.appendChild(tlsRow);
    
    targetUrlsPanel.appendChild(routeContainer);
  });
}

/** Route names where this saved pattern id is the active transform (from config). */
function routesWherePatternActive(patternId) {
  if (!patternId || !configJson || !Array.isArray(configJson.routes)) return [];
  const sid = String(patternId);
  return configJson.routes
    .filter((r) => r.active_pattern_id != null && String(r.active_pattern_id) === sid)
    .map((r) => r.name)
    .filter(Boolean);
}

function formatRouteActivePattern(route) {
  const nm = route.active_pattern_name;
  const id = route.active_pattern_id;
  if (nm) {
    const shortId =
      id && String(id).length > 8
        ? ` · <code title="${escapeHtml(String(id))}">${escapeHtml(String(id).slice(0, 8))}…</code>`
        : id
          ? ` · <code>${escapeHtml(String(id))}</code>`
          : "";
    return `<span class="route-ap-label">${escapeHtml(tr("mapperActivePattern"))}:</span> <strong>${escapeHtml(nm)}</strong>${shortId}`;
  }
  if (id) {
    return `<span class="route-ap-label">${escapeHtml(tr("mapperActivePattern"))}:</span> <code>${escapeHtml(String(id).slice(0, 8))}…</code> <span class="text-muted">(${escapeHtml(tr("mapperActivePatternNameMissing"))})</span>`;
  }
  return `<span class="text-muted">${escapeHtml(tr("mapperActivePatternUnknownShort"))}</span>`;
}

function updateMapperActivePatternDisplay() {
  const el = document.getElementById("mapperActivePatternLine");
  if (!el || !mapperApplyRoute) return;
  const routeName = mapperApplyRoute.value;
  if (!routeName || !configJson || !Array.isArray(configJson.routes)) {
    el.textContent = "";
    el.classList.remove("mapper-active-pattern-highlight");
    return;
  }
  const route = configJson.routes.find((r) => r.name === routeName);
  if (!route) {
    el.textContent = "";
    el.classList.remove("mapper-active-pattern-highlight");
    return;
  }
  const nm = route.active_pattern_name;
  const id = route.active_pattern_id;
  if (nm) {
    el.classList.add("mapper-active-pattern-highlight");
    el.innerHTML =
      `<span class="mapper-active-route-label">${escapeHtml(tr("mapperActivePatternOnRoutePrefix"))} <strong>${escapeHtml(routeName)}</strong></span> — ` +
      `${escapeHtml(tr("mapperActivePattern"))}: <strong>${escapeHtml(nm)}</strong>${
        id && String(id).length > 8
          ? ` · <code title="${escapeHtml(String(id))}">${escapeHtml(String(id).slice(0, 8))}…</code>`
          : id
            ? ` · <code>${escapeHtml(String(id))}</code>`
            : ""
      }`;
  } else if (id) {
    el.classList.add("mapper-active-pattern-highlight");
    el.innerHTML = `${escapeHtml(tr("mapperActivePatternOnRoutePrefix"))} <strong>${escapeHtml(routeName)}</strong> — ${escapeHtml(tr("mapperActivePattern"))}: <code>${escapeHtml(String(id).slice(0, 8))}…</code> <span class="text-muted">(${escapeHtml(tr("mapperActivePatternNameMissing"))})</span>`;
  } else {
    el.classList.remove("mapper-active-pattern-highlight");
    el.textContent = tr("mapperActivePatternUnknownShort");
  }
}

function renderRoutes(routes) {
  if (!routesList) return;
  routesList.innerHTML = "";
  if (sourceSelect) sourceSelect.innerHTML = "";
  
  const routesEmpty = document.getElementById("routesEmpty");
  if (routesEmpty) routesEmpty.style.display = routes.length === 0 ? "block" : "none";
  
  const clientInfoPanel = document.getElementById("clientInfoPanel");
  if (clientInfoPanel) clientInfoPanel.style.display = routes.length > 0 ? "block" : "none";
  
  if (!routes.length) {
    return;
  }

  // Get API key config
  let apiKeysRequired = false;
  let apiKeysList = [];
  if (configJson && configJson.auth && configJson.auth.api_keys) {
    apiKeysRequired = configJson.auth.api_keys.required === true;
    apiKeysList = configJson.auth.api_keys.keys || [];
  }

  // Get current hostname/IP for client info
  const currentHost = window.location.hostname;
  const currentPort = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
  const baseUrl = `${window.location.protocol}//${currentHost}${currentPort !== "80" && currentPort !== "443" ? `:${currentPort}` : ""}`;

  routes.forEach((route) => {
    const source = route.match?.source || "";
    const endpoint = `/webhook/${source}`;
    const fullUrl = `${baseUrl}${endpoint}`;
    const item = document.createElement("li");
    item.className = "route-item";
    item.innerHTML = `
      <div class="route-header">
        <strong class="route-name">${escapeHtml(route.name)}</strong>
        <code class="route-endpoint">POST ${escapeHtml(endpoint)}</code>
      </div>
      <div class="route-meta">
        <span class="route-source-label">Source:</span>
        <span class="route-source-value">${escapeHtml(source)}</span>
      </div>
      <div class="route-active-pattern-line">${formatRouteActivePattern(route)}</div>
    `;
    routesList.appendChild(item);

    if (sourceSelect) {
      const option = document.createElement("option");
      option.value = source;
      option.textContent = `${source} (${route.name})`;
      sourceSelect.appendChild(option);
    }
  });

  // Render client info
  if (clientInfoPanel && routes.length > 0) {
    const clientInfoContent = document.getElementById("clientInfoContent");
    if (clientInfoContent) {
      let html = `<div class="client-info-section">`;
      html += `<h4>Webhook URL</h4>`;
      html += `<p>${tr("clientSendTo")}</p>`;
      html += `<p class="client-url-scope text-muted">${tr("clientWebExternal")}</p>`;
      routes.forEach((route) => {
        const source = route.match?.source || "";
        const endpoint = `/webhook/${source}`;
        const fullUrl = `${baseUrl}${endpoint}`;
        html += `<div class="client-url-box">`;
        html += `<code class="client-url">${escapeHtml(fullUrl)}</code>`;
        html += `<button type="button" class="btn btn-secondary btn-copy-url" data-url="${escapeHtml(fullUrl)}">Copy</button>`;
        html += `</div>`;
      });
      if (internalWebhookBase) {
        const ib = String(internalWebhookBase).replace(/\/$/, "");
        html += `<p class="client-url-scope text-muted" style="margin-top:14px;">${tr("clientWebCluster")}</p>`;
        routes.forEach((route) => {
          const source = route.match?.source || "";
          const endpoint = `/webhook/${source}`;
          const fullIn = `${ib}${endpoint}`;
          html += `<div class="client-url-box">`;
          html += `<code class="client-url">${escapeHtml(fullIn)}</code>`;
          html += `<button type="button" class="btn btn-secondary btn-copy-url" data-url="${escapeHtml(fullIn)}">Copy</button>`;
          html += `</div>`;
        });
      }
      html += `</div>`;
      
      html += `<div class="client-info-section">`;
      html += `<h4>Authentication</h4>`;
      if (apiKeysRequired && apiKeysList.length > 0) {
        html += `<p><strong style="color: var(--warn);">${tr("apiKeyRequired")}</strong></p>`;
        html += `<div class="client-auth-methods">`;
        html += `<div class="auth-method">`;
        html += `<strong>${tr("method1")}</strong> <code>X-API-Key</code><br>`;
        html += `<code class="auth-example">curl -X POST "${baseUrl}/webhook/ocp" \\<br>`;
        html += `  -H "X-API-Key: YOUR_API_KEY_HERE" \\<br>`;
        html += `  -H "Content-Type: application/json" \\<br>`;
        html += `  -d '{"status":"firing",...}'</code>`;
        html += `</div>`;
        html += `<div class="auth-method">`;
        html += `<strong>${tr("method2")}</strong> <code>Authorization: Bearer</code><br>`;
        html += `<code class="auth-example">curl -X POST "${baseUrl}/webhook/ocp" \\<br>`;
        html += `  -H "Authorization: Bearer YOUR_API_KEY_HERE" \\<br>`;
        html += `  -H "Content-Type: application/json" \\<br>`;
        html += `  -d '{"status":"firing",...}'</code>`;
        html += `</div>`;
        html += `<p style="margin-top: 12px;"><strong>${tr("apiKeysAvailable")}</strong></p>`;
        html += `<ul class="api-keys-for-client">`;
        apiKeysList.forEach((k) => {
          html += `<li><code>${escapeHtml(k.name)}</code> - Prefix: <code>${escapeHtml(k.key_prefix || "")}</code></li>`;
        });
        html += `</ul>`;
        html += `<p class="text-muted" style="font-size: 12px; margin-top: 8px;">${tr("copyFromSection")}</p>`;
        html += `</div>`;
      } else {
        html += `<p style="color: var(--accent);">${tr("noApiKey")}</p>`;
      }
      html += `</div>`;
      
      html += `<div class="client-info-section">`;
      html += `<h4>${tr("requestFormat")}</h4>`;
      html += `<p>Content-Type: <code>application/json</code></p>`;
      html += `<p>${tr("bodyFormat")}</p>`;
      html += `</div>`;
      
      html += `<div class="client-info-section">`;
      html += `<h4>${tr("troubleshooting")}</h4>`;
      html += `<ul class="troubleshooting-list">`;
      html += `<li><strong>401 Unauthorized:</strong> ${tr("t401")}</li>`;
      html += `<li><strong>404 Not Found:</strong> ${tr("t404")}</li>`;
      html += `<li><strong>Connection refused:</strong> ${tr("tConnRefused")}</li>`;
      html += `<li><strong>Invalid JSON:</strong> ${tr("tInvalidJson")}</li>`;
      html += `</ul>`;
      html += `</div>`;
      
      clientInfoContent.innerHTML = html;
      
      // Add copy button handlers
      clientInfoContent.querySelectorAll(".btn-copy-url").forEach((btn) => {
        btn.addEventListener("click", () => {
          const url = btn.getAttribute("data-url");
          navigator.clipboard.writeText(url).then(() => {
            btn.textContent = "Copied!";
            setTimeout(() => { btn.textContent = "Copy"; }, 2000);
          }).catch(() => {});
        });
      });
    }
  }
}

saveBtn.addEventListener("click", async () => {
  configStatus.textContent = "Saving...";
  try {
    const response = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: configTextarea.value,
      credentials: "include",
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Save failed");
    }

    configStatus.textContent = "Saved";
    await loadConfig();
  } catch (error) {
    configStatus.textContent = `Error: ${error.message}`;
  }
});

reloadBtn.addEventListener("click", async () => {
  configStatus.textContent = "Reloading...";
  try {
    const response = await fetch("/admin/reload", { method: "POST", credentials: "include" });
    if (!response.ok) {
      throw new Error("Reload failed");
    }
    configStatus.textContent = "Reloaded";
    await loadConfig();
  } catch (error) {
    configStatus.textContent = `Error: ${error.message}`;
  }
});

saveTargetUrlsBtn.addEventListener("click", async () => {
  if (!configJson || !configJson.routes) return;
  targetUrlsStatus.textContent = "Saving...";
  try {
    const warnings = [];
    configJson.routes.forEach((route) => {
      if (!route.target) route.target = {};
      const routeName = route.name;

      const fwdEnabled = targetUrlsPanel.querySelector(`input[data-route-name="${routeName}"][data-field="forward_enabled"]`);
      route.forward_enabled = fwdEnabled ? fwdEnabled.checked : true;
      
      // URL
      const urlInput = targetUrlsPanel.querySelector(`input[data-route-name="${routeName}"][data-field="url"]`);
      route.target.url = urlInput ? urlInput.value.trim() || null : null;
      
      // API Key Header
      const headerSelect = targetUrlsPanel.querySelector(`select[data-route-name="${routeName}"][data-field="api_key_header"]`);
      const selectedHeader = headerSelect && headerSelect.value ? headerSelect.value : "";
      route.target.api_key_header = selectedHeader || null;
      
      // API Key Value
      const apiKeyInput = targetUrlsPanel.querySelector(`input[data-route-name="${routeName}"][data-field="api_key"]`);
      const apiKeyValue = apiKeyInput && apiKeyInput.value.trim() ? apiKeyInput.value.trim() : null;
      
      // API Key Env Var
      const apiKeyEnvInput = targetUrlsPanel.querySelector(`input[data-route-name="${routeName}"][data-field="api_key_env"]`);
      const apiKeyEnvValue = apiKeyEnvInput && apiKeyEnvInput.value.trim() ? apiKeyEnvInput.value.trim() : null;

      if (!selectedHeader) {
        // Explicitly disable outbound API key auth for this route.
        route.target.api_key = null;
        route.target.api_key_env = null;
      } else {
        route.target.api_key = apiKeyValue;
        route.target.api_key_env = apiKeyEnvValue;
        if (!apiKeyValue && !apiKeyEnvValue) {
          warnings.push(`${routeName}: API key header selected but key/env is empty`);
        }
      }

      // TLS
      const verifySelect = targetUrlsPanel.querySelector(`select[data-route-name="${routeName}"][data-field="verify_tls"]`);
      route.target.verify_tls = verifySelect && verifySelect.value === "false" ? false : null;
      const caCertInput = targetUrlsPanel.querySelector(`input[data-route-name="${routeName}"][data-field="ca_cert"]`);
      route.target.ca_cert = caCertInput && caCertInput.value.trim() ? caCertInput.value.trim() : null;
      const caCertEnvInput = targetUrlsPanel.querySelector(`input[data-route-name="${routeName}"][data-field="ca_cert_env"]`);
      route.target.ca_cert_env = caCertEnvInput && caCertEnvInput.value.trim() ? caCertEnvInput.value.trim() : null;
    });
    const response = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(configJson),
      credentials: "include",
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || "Save failed");
    }
    targetUrlsStatus.textContent = "Saving... reloading rules...";
    const reloadRes = await fetch("/admin/reload", { method: "POST", credentials: "include" });
    if (reloadRes.ok) {
      const warnTxt = warnings.length ? ` Warning: ${warnings.join(" | ")}` : "";
      targetUrlsStatus.textContent = `Saved & reloaded. If forward still fails, run: python scripts/mock_receiver.py${warnTxt}`;
    } else {
      const warnTxt = warnings.length ? ` Warning: ${warnings.join(" | ")}` : "";
      targetUrlsStatus.textContent = `Saved (reload failed). Try Reload button.${warnTxt}`;
    }
    await loadEffectiveTargets();
    await loadConfig();
  } catch (error) {
    targetUrlsStatus.textContent = `Error: ${error.message}`;
  }
});

previewBtn.addEventListener("click", async () => {
  previewStatus.textContent = "Previewing...";
  previewOutput.textContent = "";

  const source = sourceSelect.value;
  if (!source) {
    previewStatus.textContent = "Select a source";
    return;
  }

  let samplePayload;
  try {
    samplePayload = JSON.parse(sampleTextarea.value || "{}");
  } catch (error) {
    previewStatus.textContent = "Invalid JSON";
    return;
  }

  try {
    const response = await fetch(`/api/transform/${source}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(samplePayload),
      credentials: "include",
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Preview failed");
    }

    const output = await response.json();
    previewOutput.textContent = JSON.stringify(output, null, 2);
    previewStatus.textContent = "OK";
  } catch (error) {
    previewStatus.textContent = `Error: ${error.message}`;
  }
});

function drawHeartbeatChart(data) {
  if (!heartbeatChart || !data.length) return;

  const dpr = window.devicePixelRatio || 1;
  const wrap = heartbeatChart.parentElement;
  const rawW = (wrap && wrap.clientWidth) || 800;
  const cw = Math.min(rawW, 1200);
  const ch = 140;
  heartbeatChart.width = cw * dpr;
  heartbeatChart.height = ch * dpr;
  heartbeatChart.style.width = cw + "px";
  heartbeatChart.style.height = ch + "px";

  const ctx = heartbeatChart.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  const w = cw;
  const h = ch;

  ctx.clearRect(0, 0, w, h);

  const padding = { top: 12, right: 12, bottom: 12, left: 12 };
  const graphW = w - padding.left - padding.right;
  const graphH = h - padding.top - padding.bottom;

  const maxVal = Math.max(1, ...data);
  const scaleY = graphH / maxVal;

  const points = [];
  const step = graphW / Math.max(1, data.length - 1);
  for (let i = 0; i < data.length; i++) {
    const x = padding.left + i * step;
    const y = padding.top + graphH - data[i] * scaleY;
    points.push({ x, y });
  }

  if (points.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.lineTo(points[points.length - 1].x, padding.top + graphH);
  ctx.lineTo(points[0].x, padding.top + graphH);
  ctx.closePath();
  ctx.fillStyle = "rgba(13, 148, 136, 0.12)";
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.strokeStyle = "#0d9488";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
}

function setHeaderBadge(container, textEl, state, labelKey, detail) {
  if (!container || !textEl) return;
  container.classList.remove("state-ok", "state-partial", "state-down", "state-disabled", "state-checking");
  container.classList.add(`state-${state}`);
  const prefix = tr(labelKey);
  textEl.textContent = `${prefix}: ${detail}`;
}

async function loadPortalStatus() {
  try {
    const response = await fetch("/api/portal-status", { credentials: "include" });
    if (!response.ok) return;
    const data = await response.json();
    if (data.routes) {
      targetStatusCache = {
        routes: data.routes || [],
        has_any_target: data.has_any_target,
        all_ok: data.all_ok,
      };
    }
    if (targetsCache.length) renderTargetUrlsEffective(targetsCache, targetStatusCache.routes);

    const inc = data.incoming || {};
    setHeaderBadge(statusIncoming, statusIncomingText, inc.state || "down", "statusIncomingShort", inc.detail || "");

    const fwd = data.forward || {};
    setHeaderBadge(statusForward, statusForwardText, fwd.state || "down", "statusForwardShort", fwd.detail || "");

    const dlq = data.dlq || {};
    setHeaderBadge(statusDlq, statusDlqText, dlq.state || "down", "statusDlqShort", dlq.detail || "");
  } catch {
    setHeaderBadge(statusIncoming, statusIncomingText, "down", "statusIncomingShort", tr("statusUnknown"));
    setHeaderBadge(statusForward, statusForwardText, "down", "statusForwardShort", tr("statusUnknown"));
    setHeaderBadge(statusDlq, statusDlqText, "down", "statusDlqShort", tr("statusUnknown"));
  }
}

async function loadStatsAndChart() {
  try {
    const response = await fetch("/api/stats", { credentials: "include" });
    if (!response.ok) {
      if (statsStatus) statsStatus.textContent = "Could not load count";
      return;
    }
    const data = await response.json();
    const total = data.total_requests ?? 0;

    let rate = 0;
    if (lastTotalRequests != null) {
      rate = Math.max(0, total - lastTotalRequests);
    }
    lastTotalRequests = total;
    rateHistory.push(rate);
    while (rateHistory.length > RATE_HISTORY_MAX) rateHistory.shift();

    if (heartbeatLabel) heartbeatLabel.textContent = rate + " req/s";
    drawHeartbeatChart(rateHistory);

    if (statsTotal) statsTotal.textContent = String(total);
    const bySource = data.by_source || {};
    if (statsBySource) statsBySource.textContent = Object.keys(bySource).length
      ? Object.entries(bySource)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ")
      : "-";
    if (statsForwardOk) statsForwardOk.textContent = String(data.forward_success ?? 0);
    if (statsForwardFail) statsForwardFail.textContent = String(data.forward_fail ?? 0);
    if (statsStatus) statsStatus.textContent = "Last updated";
  } catch (err) {
    if (statsStatus) statsStatus.textContent = "Failed to load count";
  }
}

function renderLiveRequests(list) {
  if (!liveRequestsBody || !liveRequestsEmpty) return;
  const pageSize = Number(document.getElementById("livePageSize")?.value || 10);
  const pageInfo = document.getElementById("livePageInfo");
  const prevBtn = document.getElementById("livePrevBtn");
  const nextBtn = document.getElementById("liveNextBtn");
  if (!list || list.length === 0) {
    liveRequestsBody.innerHTML = "";
    liveRequestsEmpty.style.display = "block";
    if (pageInfo) pageInfo.textContent = "0/0";
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    return;
  }
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  if (livePage > totalPages) livePage = totalPages;
  if (livePage < 1) livePage = 1;
  const start = (livePage - 1) * pageSize;
  const paged = list.slice(start, start + pageSize);
  liveRequestsEmpty.style.display = "none";
  liveRequestsBody.innerHTML = paged
    .map(
      (r) =>
        `<tr>
          <td>${escapeHtml(r.ts || "")}</td>
          <td>${escapeHtml(r.source || "")}</td>
          <td>${escapeHtml(r.route || "")}</td>
          <td class="live-alert-summary" title="${escapeHtml(r.alert_summary || "")}">${escapeHtml((r.alert_summary || "-").slice(0, 60))}${(r.alert_summary || "").length > 60 ? "…" : ""}</td>
          <td class="td-severity">${severityBadgeHtml(r.alert_severity)}</td>
          <td class="status-${r.http_status || ""}">${escapeHtml(String(r.http_status || ""))}</td>
          <td class="${r.forwarded ? "forwarded-ok" : "forwarded-fail"}">${r.forwarded ? "yes" : "no"}</td>
          <td><code>${escapeHtml((r.request_id || "").slice(0, 8))}</code></td>
        </tr>`
    )
    .join("");
  if (pageInfo) pageInfo.textContent = `${livePage}/${totalPages}`;
  if (prevBtn) prevBtn.disabled = livePage <= 1;
  if (nextBtn) nextBtn.disabled = livePage >= totalPages;
}
function escapeHtml(s) {
  if (s == null) return "";
  const div = document.createElement("div");
  div.textContent = String(s);
  return div.innerHTML;
}

/** Severity from alert payload (labels.severity, commonLabels, etc.) for table columns. */
function severityBadgeHtml(sev) {
  const s = sev != null ? String(sev).trim() : "";
  if (!s) return "—";
  const lower = s.toLowerCase();
  let cls = "severity-badge severity-default";
  if (/(critical|emergency|fatal|disaster)/i.test(lower)) cls = "severity-badge severity-critical";
  else if (/(warning|warn)/i.test(lower)) cls = "severity-badge severity-warning";
  else if (/info(rmation)?/i.test(lower)) cls = "severity-badge severity-info";
  else if (/(page|none|normal)/i.test(lower)) cls = "severity-badge severity-low";
  return `<span class="${cls}" title="${escapeHtml(s)}">${escapeHtml(s)}</span>`;
}

async function loadLiveRequests() {
  try {
    const response = await fetch("/api/recent-requests", { credentials: "include" });
    if (!response.ok) return;
    const data = await response.json();
    liveRequestsCache = Array.isArray(data) ? data : [];
    renderLiveRequests(liveRequestsCache);
  } catch (err) {}
}

function filterFailedEvents(list, q) {
  if (!q || !q.trim()) return list;
  const ql = q.trim().toLowerCase();
  return list.filter((r) => {
    const src = (r.source || "").toLowerCase();
    const route = (r.route || "").toLowerCase();
    const rid = (r.request_id || "").toLowerCase();
    const err = (r.error || "").toLowerCase();
    const preview = (r.payload_preview || "").toLowerCase();
    const sev = (r.alert_severity || "").toLowerCase();
    return src.includes(ql) || route.includes(ql) || rid.includes(ql) || err.includes(ql) || preview.includes(ql) || sev.includes(ql);
  });
}

function renderFailedEvents(list) {
  if (!failedEventsBody || !failedEventsEmpty) return;
  const q = failedEventsSearch ? failedEventsSearch.value.trim() : "";
  const filtered = filterFailedEvents(list, q);
  const pageSize = Number(document.getElementById("failedPageSize")?.value || 10);
  const pageInfo = document.getElementById("failedPageInfo");
  const prevBtn = document.getElementById("failedPrevBtn");
  const nextBtn = document.getElementById("failedNextBtn");
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  if (failedPage > totalPages) failedPage = totalPages;
  if (failedPage < 1) failedPage = 1;
  const start = (failedPage - 1) * pageSize;
  const toShow = filtered.slice(start, start + pageSize);
  if (!toShow.length) {
    failedEventsBody.innerHTML = "";
    failedEventsEmpty.style.display = "block";
    failedEventsEmpty.textContent = q
      ? tr("noMatchesForSearch")
      : tr("failedEmpty");
    if (pageInfo) pageInfo.textContent = "0/0";
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    return;
  }
  failedEventsEmpty.style.display = "none";
  failedEventsBody.innerHTML = toShow
    .map((r) =>
      `<tr>
        <td>${escapeHtml(r.ts || "")}</td>
        <td>${escapeHtml(r.source || "")}</td>
        <td>${escapeHtml(r.route || "")}</td>
        <td class="td-severity">${severityBadgeHtml(r.alert_severity)}</td>
        <td class="status-${r.http_status || ""}">${escapeHtml(String(r.http_status || ""))}</td>
        <td><code>${escapeHtml((r.request_id || "").slice(0, 8))}</code></td>
        <td class="failed-error-cell" title="${escapeHtml(r.error || "")}">${escapeHtml((r.error || r.payload_preview || "").slice(0, 60))}${(r.error || r.payload_preview || "").length > 60 ? "…" : ""}</td>
      </tr>`
    )
    .join("");
  if (pageInfo) pageInfo.textContent = `${failedPage}/${totalPages}`;
  if (prevBtn) prevBtn.disabled = failedPage <= 1;
  if (nextBtn) nextBtn.disabled = failedPage >= totalPages;
}

async function loadFailedEvents() {
  try {
    const response = await fetch("/api/recent-failed", { credentials: "include" });
    if (!response.ok) return;
    const data = await response.json();
    failedEventsCache = Array.isArray(data) ? data : [];
    renderFailedEvents(failedEventsCache);
  } catch (err) {}
}

function renderDailyMetrics(rows) {
  const body = document.getElementById("dailyMetricsBody");
  const empty = document.getElementById("dailyMetricsEmpty");
  if (!body || !empty) return;
  if (!Array.isArray(rows) || rows.length === 0) {
    body.innerHTML = "";
    empty.style.display = "block";
    empty.textContent = tr("dailyEmpty");
    return;
  }
  empty.style.display = "none";
  body.innerHTML = rows.map((r) => `
    <tr>
      <td>${escapeHtml(r.date || "")}</td>
      <td>${escapeHtml(String(r.incoming ?? 0))}</td>
      <td>${escapeHtml(String(r.forward_success ?? 0))}</td>
      <td>${escapeHtml(String(r.forward_fail ?? 0))}</td>
      <td>${escapeHtml(String(r.dlq ?? 0))}</td>
      <td>${escapeHtml(r.updated_at || "")}</td>
    </tr>
  `).join("");
}

async function loadDailyMetrics() {
  const statusEl = document.getElementById("dailyStatus");
  const daysEl = document.getElementById("dailyDays");
  const days = (daysEl && daysEl.value) ? daysEl.value : "30";
  if (statusEl) statusEl.textContent = tr("dailyLoading");
  try {
    const res = await fetch(`/api/metrics/daily?days=${encodeURIComponent(days)}`, { credentials: "include" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (statusEl) statusEl.textContent = data.detail || `HTTP ${res.status}`;
      renderDailyMetrics([]);
      return;
    }
    if (data.configured === false) {
      if (statusEl) statusEl.textContent = tr("dailyOff");
      renderDailyMetrics([]);
      return;
    }
    if (statusEl) statusEl.textContent = "";
    renderDailyMetrics(data.entries || []);
  } catch (e) {
    if (statusEl) statusEl.textContent = String(e);
    renderDailyMetrics([]);
  }
}

// ---------- Field Mapper ----------
async function loadPatternSchemas() {
  if (!mapperSourceType) return;
  try {
    const res = await fetch("/api/pattern-schemas", { credentials: "include" });
    if (!res.ok) return;
    patternSchemas = await res.json();
    mapperSourceType.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "— Select alert source —";
    mapperSourceType.appendChild(opt0);
    for (const [id, schema] of Object.entries(patternSchemas.source_schemas || {})) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = schema.name || id;
      mapperSourceType.appendChild(opt);
    }
    const optCustom = document.createElement("option");
    optCustom.value = "custom-paste";
    optCustom.textContent = "Custom (paste example log)";
    mapperSourceType.appendChild(optCustom);
    mapperSourceType.addEventListener("change", onMapperSourceTypeChange);
    renderMapperMappingTable();
  } catch (err) {}
}

function onMapperSourceTypeChange() {
  const snap = getMappingsFromForm();
  const id = mapperSourceType.value;
  if (!mapperSourceDescription || !mapperSourceFields) return;
  if (mapperSourceCustomWrap) mapperSourceCustomWrap.style.display = id === "custom-paste" ? "flex" : "none";
  const mergeWrap = document.getElementById("mapperMergeSchemasWrap");
  if (mergeWrap) mergeWrap.style.display = id ? "flex" : "none";
  if (!id) {
    mapperSourceDescription.textContent = "";
    mapperSourceFields.innerHTML = "";
  } else if (id === "custom-paste") {
    mapperSourceDescription.textContent = tr("mapperCustomPasteDesc");
    const merged = getMapperSourceFieldsList();
    if (merged.length) {
      mapperSourceFields.innerHTML = merged.map((f) =>
        `<li data-field-id="${escapeHtml(f.id)}">${escapeHtml(f.label)}</li>`
      ).join("");
    } else {
      mapperSourceFields.innerHTML = `<li class="text-muted">${escapeHtml(tr("mapperCustomPasteEmpty"))}</li>`;
    }
  } else {
    const schema = (patternSchemas.source_schemas || {})[id];
    if (schema) {
      mapperSourceDescription.textContent = schema.description || "";
      const merged = getMapperSourceFieldsList();
      mapperSourceFields.innerHTML = merged.length
        ? merged.map((f) => `<li data-field-id="${escapeHtml(f.id)}">${escapeHtml(f.label)}</li>`).join("")
        : (schema.fields || []).map((f) =>
            `<li data-field-id="${escapeHtml(f.id)}">${escapeHtml(f.label)}</li>`
          ).join("");
    } else {
      mapperSourceDescription.textContent = "";
      mapperSourceFields.innerHTML = "";
    }
  }
  fillMapperSourceOptionSelects();
  setMappingsToForm(snap);
  fillMapperSourceOptionSelects();
}

/** Merged field list for dropdowns: custom paths + optional built-in schemas (Custom mode only). */
/** Order source paths for dropdowns: top-level webhook fields before alerts.* (alphabetical hid status/receiver). */
function mapperSourceFieldDisplayRank(fieldId) {
  const s = String(fieldId || "");
  if (s === "status" || s === "receiver") return 0;
  if (s === "externalURL" || s === "version" || s === "groupKey" || s === "truncatedAlerts") return 1;
  if (s.startsWith("groupLabels.")) return 10;
  if (s.startsWith("commonLabels.")) return 11;
  if (s.startsWith("commonAnnotations.")) return 12;
  if (s.startsWith("alerts.")) return 20;
  if (!s.includes(".")) return 5;
  return 15;
}

function getMapperSourceFieldsList() {
  const id = mapperSourceType && mapperSourceType.value;
  const seen = new Set();
  const out = [];
  function addField(f) {
    if (!f || !f.id || seen.has(f.id)) return;
    seen.add(f.id);
    out.push(f);
  }
  if (!id) return [];
  if (id === "custom-paste") {
    (customSourceFields || []).forEach(addField);
  } else {
    ((patternSchemas.source_schemas || {})[id]?.fields || []).forEach(addField);
  }
  if (id && id !== "") {
    const mergeOcp = document.getElementById("mapperMergeOcp");
    const mergeCf = document.getElementById("mapperMergeConfluent");
    if (mergeOcp && mergeOcp.checked) {
      ((patternSchemas.source_schemas || {})["ocp-alertmanager-4.20"]?.fields || []).forEach(addField);
    }
    if (mergeCf && mergeCf.checked) {
      ((patternSchemas.source_schemas || {})["confluent-8.10"]?.fields || []).forEach(addField);
    }
  }
  out.sort((a, b) => {
    const ra = mapperSourceFieldDisplayRank(a.id);
    const rb = mapperSourceFieldDisplayRank(b.id);
    if (ra !== rb) return ra - rb;
    return String(a.id).localeCompare(String(b.id));
  });
  return out;
}

function mapperApplyColumnButtonI18n(addBtn, rmBtn) {
  if (addBtn) {
    const t = tr("mapperAddSourceColumnAria");
    addBtn.setAttribute("aria-label", t);
    addBtn.title = t;
  }
  if (rmBtn) {
    const t = tr("mapperRemoveSourceColumnAria");
    rmBtn.setAttribute("aria-label", t);
    rmBtn.title = t;
  }
}

/** One horizontal source column: index badge, field select, + / − chrome. */
function mapperBuildSourceColumnElement(tid, idx) {
  const div = document.createElement("div");
  div.className = "mapper-src-col";
  div.setAttribute("data-opt-idx", String(idx));
  const num = document.createElement("span");
  num.className = "mapper-src-col-num";
  num.textContent = String(idx + 1);
  num.setAttribute("aria-hidden", "true");
  const sel = document.createElement("select");
  sel.className = "mapper-src-opt";
  sel.setAttribute("data-target-id", tid);
  sel.innerHTML = "<option value=\"\">—</option>";
  const actions = document.createElement("div");
  actions.className = "mapper-src-col-actions";
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "mapper-src-col-btn mapper-src-add-col";
  addBtn.textContent = "+";
  const rmBtn = document.createElement("button");
  rmBtn.type = "button";
  rmBtn.className = "mapper-src-col-btn mapper-src-remove-col";
  rmBtn.textContent = "−";
  mapperApplyColumnButtonI18n(addBtn, rmBtn);
  actions.appendChild(addBtn);
  actions.appendChild(rmBtn);
  div.appendChild(num);
  div.appendChild(sel);
  div.appendChild(actions);
  return div;
}

function mapperSyncColumnChrome(wrap) {
  if (!wrap) return;
  const cols = wrap.querySelectorAll(".mapper-src-col");
  const n = cols.length;
  cols.forEach((col, i) => {
    col.setAttribute("data-opt-idx", String(i));
    const num = col.querySelector(".mapper-src-col-num");
    if (num) num.textContent = String(i + 1);
    const addBtn = col.querySelector(".mapper-src-add-col");
    const rmBtn = col.querySelector(".mapper-src-remove-col");
    if (rmBtn) rmBtn.hidden = n <= 1;
    if (addBtn) addBtn.disabled = n >= MAPPER_MAX_SRC_OPTS;
  });
}

function mapperSetOptionRowCount(rowEl, count) {
  const wrap = rowEl.querySelector(".mapper-src-opt-rows");
  if (!wrap) return;
  const min = 1;
  const max = MAPPER_MAX_SRC_OPTS;
  const n = Math.max(min, Math.min(max, count));
  const tid = rowEl.getAttribute("data-target-id");
  let cols = wrap.querySelectorAll(".mapper-src-col");
  while (cols.length < n) {
    wrap.appendChild(mapperBuildSourceColumnElement(tid, cols.length));
    cols = wrap.querySelectorAll(".mapper-src-col");
  }
  while (cols.length > n) {
    wrap.removeChild(cols[cols.length - 1]);
    cols = wrap.querySelectorAll(".mapper-src-col");
  }
  mapperSyncColumnChrome(wrap);
}

function onMapperSrcGridClick(ev) {
  const addBtn = ev.target.closest(".mapper-src-add-col");
  const rmBtn = ev.target.closest(".mapper-src-remove-col");
  if (!addBtn && !rmBtn) return;
  const trigger = addBtn || rmBtn;
  const col = trigger.closest(".mapper-src-col");
  const wrap = col && col.closest(".mapper-src-opt-rows");
  if (!col || !wrap) return;
  const rowEl = wrap.closest("tr[data-target-id]");
  if (!rowEl) return;
  const tid = rowEl.getAttribute("data-target-id");
  const cols = [...wrap.querySelectorAll(".mapper-src-col")];
  const idx = cols.indexOf(col);
  if (idx < 0) return;

  if (addBtn) {
    if (cols.length >= MAPPER_MAX_SRC_OPTS) return;
    const neu = mapperBuildSourceColumnElement(tid, idx + 1);
    col.insertAdjacentElement("afterend", neu);
    mapperSyncColumnChrome(wrap);
    fillMapperSourceOptionSelects();
    neu.querySelector(".mapper-src-opt")?.focus();
    return;
  }
  if (rmBtn) {
    if (cols.length <= 1) return;
    col.remove();
    mapperSyncColumnChrome(wrap);
    fillMapperSourceOptionSelects();
  }
}

function attachMapperMergeAndOptionListeners() {
  if (mapperMergeListenersAttached) return;
  mapperMergeListenersAttached = true;
  ["mapperMergeOcp", "mapperMergeConfluent"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      onMapperSourceTypeChange();
    });
  });
  mapperMappingBody?.addEventListener("click", onMapperSrcGridClick);
  mapperMappingBody?.addEventListener("change", (ev) => {
    const rowEl = ev.target.closest("tr[data-target-id]");
    if (ev.target.classList && ev.target.classList.contains("mapper-concat-preset") && rowEl) {
      mapperSyncConcatCustomInputVisibility(rowEl);
    }
    if (rowEl) rowEl.classList.remove("mapper-row-invalid");
  });
}

function mapperSourceColumnHtmlString(tid, idx) {
  const el = mapperBuildSourceColumnElement(tid, idx);
  return el.outerHTML;
}

function mapperRowByTargetId(targetId) {
  if (!mapperMappingBody) return null;
  const rows = mapperMappingBody.querySelectorAll("tr[data-target-id]");
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].getAttribute("data-target-id") === targetId) return rows[i];
  }
  return null;
}

/** If path is not in the schema dropdown, add it so Load / route round-trip works. */
function mapperEnsureSourceOption(sel, value) {
  if (!sel || value == null || String(value).trim() === "") return;
  const v = String(value).trim();
  const exists = Array.from(sel.options).some((o) => o.value === v);
  if (exists) return;
  const opt = document.createElement("option");
  opt.value = v;
  opt.textContent = v;
  if (sel.options.length > 1) sel.insertBefore(opt, sel.options[1]);
  else sel.appendChild(opt);
}

function mapperConcatPresetOptionsHtml() {
  return MAPPER_CONCAT_PRESETS.map((p) =>
    `<option value="${escapeHtml(p.id)}">${escapeHtml(tr(p.labelKey))}</option>`
  ).join("");
}

function mapperTemplateToPresetId(t) {
  const s = String(t || "").trim();
  if (!s) return "";
  for (const p of MAPPER_CONCAT_PRESETS) {
    if (p.id && p.template !== null && p.template === s) return p.id;
  }
  return "custom";
}

function mapperGetConcatTemplateFromRow(rowEl) {
  const sel = rowEl.querySelector(".mapper-concat-preset");
  const input = rowEl.querySelector(".mapper-concat-template-input");
  if (!sel) return input ? input.value.trim() : "";
  if (sel.value === "custom") return input ? input.value.trim() : "";
  const p = MAPPER_CONCAT_PRESETS.find((x) => x.id === sel.value);
  if (!p || p.template == null) return "";
  return p.template;
}

function mapperSyncConcatCustomInputVisibility(rowEl) {
  const sel = rowEl.querySelector(".mapper-concat-preset");
  const input = rowEl.querySelector(".mapper-concat-template-input");
  if (!sel || !input) return;
  if (sel.value === "custom") {
    input.style.display = "";
    input.placeholder = tr("mapperConcatTemplatePlaceholder");
    return;
  }
  input.style.display = "none";
  if (sel.value === "") {
    input.value = "";
    return;
  }
  const p = MAPPER_CONCAT_PRESETS.find((x) => x.id === sel.value);
  input.value = p && p.template != null ? p.template : "";
}

function mapperApplyConcatPresetToRow(rowEl, templateString) {
  const sel = rowEl.querySelector(".mapper-concat-preset");
  const input = rowEl.querySelector(".mapper-concat-template-input");
  if (!sel || !input) return;
  const t = String(templateString || "").trim();
  if (!t) {
    sel.value = "";
    input.value = "";
    input.style.display = "none";
    return;
  }
  const presetId = mapperTemplateToPresetId(t);
  if (presetId === "custom") {
    sel.value = "custom";
    input.value = t;
    input.style.display = "";
    input.placeholder = tr("mapperConcatTemplatePlaceholder");
    return;
  }
  sel.value = presetId;
  mapperSyncConcatCustomInputVisibility(rowEl);
}

function renderMapperMappingTable() {
  if (!mapperMappingBody) return;
  /** Preserve edits when this full re-render is triggered (e.g. live payload / new target parse), not only source-type change. */
  const snap = getMappingsFromForm();
  const targets = targetFieldsFromUpload.length > 0 ? targetFieldsFromUpload : (patternSchemas.target_fields || []);
  const presetOpts = mapperConcatPresetOptionsHtml();
  mapperMappingBody.innerHTML = targets.map((t) => {
    const vid = `map-val-${t.id}`;
    return `<tr data-target-id="${escapeHtml(t.id)}">
      <td><strong>${escapeHtml(t.label)}</strong></td>
      <td class="mapper-src-cell">
        <div class="mapper-src-opts" data-target-id="${escapeHtml(t.id)}">
          <div class="mapper-src-opt-rows mapper-src-grid">
            ${mapperSourceColumnHtmlString(t.id, 0)}
          </div>
        </div>
      </td>
      <td class="mapper-concat-cell">
        <select class="select mapper-concat-preset" data-target-id="${escapeHtml(t.id)}">${presetOpts}</select>
        <input type="text" class="mapper-concat-template-input" data-target-id="${escapeHtml(t.id)}" value="" style="display:none" autocomplete="off" />
      </td>
      <td><input type="text" id="${vid}" class="mapper-static-input" data-target-id="${escapeHtml(t.id)}" placeholder="optional static" /></td>
    </tr>`;
  }).join("");
  mapperMappingBody.querySelectorAll(".mapper-src-opt-rows").forEach((w) => mapperSyncColumnChrome(w));
  onMapperSourceTypeChange();
  setMappingsToForm(snap);
  fillMapperSourceOptionSelects();
}

function fillMapperSourceOptionSelects() {
  const sourceFields = getMapperSourceFieldsList();
  if (!mapperMappingBody) return;
  mapperMappingBody.querySelectorAll(".mapper-src-opt").forEach((sel) => {
    const current = sel.value;
    sel.innerHTML = "<option value=\"\">—</option>" + sourceFields.map((f) =>
      `<option value="${escapeHtml(f.id)}" ${f.id === current ? "selected" : ""}>${escapeHtml(f.label)}</option>`
    ).join("");
    if (current && String(current).trim() !== "") {
      mapperEnsureSourceOption(sel, current);
      sel.value = current;
    }
  });
}

function mapperPathsInMapping(m) {
  if (!m) return [];
  if (m.static_value != null && m.static_value !== "") return [];
  if (Array.isArray(m.concat_paths) && m.concat_paths.length) return m.concat_paths.map(String);
  if (Array.isArray(m.source_field_ids) && m.source_field_ids.length) return m.source_field_ids.map(String);
  if (m.source_field_id) return [String(m.source_field_id)];
  return [];
}

/**
 * Custom mode: if loaded paths belong to OCP/Confluent preset lists but not to pasted custom fields,
 * enable the corresponding merge checkboxes so dropdowns list every path (reduces load/edit mistakes).
 * @returns {boolean} true if any checkbox was turned on
 */
function mapperAutoMergePresetsForMappings(mappings) {
  const ocpFields = new Set((patternSchemas.source_schemas?.["ocp-alertmanager-4.20"]?.fields || []).map((f) => f.id));
  const cfFields = new Set((patternSchemas.source_schemas?.["confluent-8.10"]?.fields || []).map((f) => f.id));
  const customIds = new Set((customSourceFields || []).map((f) => f.id));
  let needOcp = false;
  let needCf = false;
  for (const m of mappings) {
    for (const p of mapperPathsInMapping(m)) {
      if (ocpFields.has(p) && !customIds.has(p)) needOcp = true;
      if (cfFields.has(p) && !customIds.has(p)) needCf = true;
    }
  }
  const mergeOcp = document.getElementById("mapperMergeOcp");
  const mergeCf = document.getElementById("mapperMergeConfluent");
  let toggled = false;
  if (needOcp && mergeOcp && !mergeOcp.checked) {
    mergeOcp.checked = true;
    toggled = true;
  }
  if (needCf && mergeCf && !mergeCf.checked) {
    mergeCf.checked = true;
    toggled = true;
  }
  return toggled;
}

function mapperClearMappingValidationVisual() {
  if (!mapperMappingBody) return;
  mapperMappingBody.querySelectorAll("tr.mapper-row-invalid").forEach((rowEl) => rowEl.classList.remove("mapper-row-invalid"));
}

/** Reject duplicate paths in the same target row (same path in Option 1 and 2, etc.). */
function mapperValidateMappingsForSave(mappings) {
  mapperClearMappingValidationVisual();
  for (const m of mappings) {
    if (m.concat_template != null && String(m.concat_template).trim() !== "") {
      const cps = Array.isArray(m.concat_paths) ? m.concat_paths.filter((p) => p && String(p).trim()) : [];
      if (cps.length === 0) {
        const row = mapperRowByTargetId(m.target_field_id);
        if (row) row.classList.add("mapper-row-invalid");
        return {
          ok: false,
          msg: tr("mapperConcatNeedsPaths").replace("{target}", String(m.target_field_id || "?")),
        };
      }
    }
    const paths = mapperPathsInMapping(m);
    const seen = new Set();
    for (const p of paths) {
      if (seen.has(p)) {
        const row = mapperRowByTargetId(m.target_field_id);
        if (row) row.classList.add("mapper-row-invalid");
        return {
          ok: false,
          msg: tr("mapperDuplicatePathInRow").replace("{target}", String(m.target_field_id || "?")),
        };
      }
      seen.add(p);
    }
  }
  return { ok: true, msg: "" };
}

function getMappingsFromForm() {
  const mappings = [];
  if (!mapperMappingBody) return mappings;
  mapperMappingBody.querySelectorAll("tr[data-target-id]").forEach((rowEl) => {
    const targetId = rowEl.getAttribute("data-target-id");
    const concatTpl = mapperGetConcatTemplateFromRow(rowEl);
    if (concatTpl) {
      const paths = [];
      rowEl.querySelectorAll(".mapper-src-opt").forEach((sel) => {
        const v = sel.value.trim();
        if (v) paths.push(v);
      });
      mappings.push({
        target_field_id: targetId,
        concat_template: concatTpl,
        concat_paths: paths,
        source_field_id: null,
        static_value: null,
      });
      return;
    }
    const input = rowEl.querySelector(".mapper-static-input");
    const staticVal = input ? input.value.trim() : "";
    if (staticVal) {
      mappings.push({
        target_field_id: targetId,
        source_field_id: null,
        static_value: staticVal,
      });
      return;
    }
    const paths = [];
    rowEl.querySelectorAll(".mapper-src-opt").forEach((sel) => {
      const v = sel.value.trim();
      if (v) paths.push(v);
    });
    if (paths.length > 1) {
      mappings.push({
        target_field_id: targetId,
        source_field_ids: paths,
        source_field_id: null,
        static_value: null,
      });
    } else if (paths.length === 1) {
      mappings.push({
        target_field_id: targetId,
        source_field_id: paths[0],
        static_value: null,
      });
    } else {
      mappings.push({
        target_field_id: targetId,
        source_field_id: null,
        static_value: null,
      });
    }
  });
  return mappings;
}

function setMappingsToForm(mappings) {
  if (!mapperMappingBody) return;
  (mappings || []).forEach((m) => {
    const tid = m.target_field_id;
    const rowEl = mapperRowByTargetId(tid);
    if (!rowEl) return;
    const hasConcat = m.concat_template != null && String(m.concat_template).trim() !== "";
    if (hasConcat) {
      const input = rowEl.querySelector(".mapper-static-input");
      if (input) input.value = "";
      mapperApplyConcatPresetToRow(rowEl, String(m.concat_template || ""));
      const cpaths = m.concat_paths || [];
      mapperSetOptionRowCount(rowEl, Math.max(1, cpaths.length));
      const sels = rowEl.querySelectorAll(".mapper-src-opt");
      cpaths.forEach((p, i) => {
        if (sels[i]) {
          mapperEnsureSourceOption(sels[i], p);
          sels[i].value = p;
        }
      });
      for (let i = cpaths.length; i < sels.length; i++) {
        sels[i].value = "";
      }
      return;
    }
    mapperApplyConcatPresetToRow(rowEl, "");
    const input = rowEl.querySelector(".mapper-static-input");
    const staticVal = m.static_value != null && m.static_value !== "" ? String(m.static_value) : "";
    if (input) input.value = staticVal;
    if (staticVal) {
      mapperSetOptionRowCount(rowEl, 1);
      rowEl.querySelectorAll(".mapper-src-opt").forEach((s) => { s.value = ""; });
      return;
    }
    const ids = Array.isArray(m.source_field_ids) ? m.source_field_ids : null;
    const paths = ids && ids.length ? ids : (m.source_field_id ? [m.source_field_id] : []);
    mapperSetOptionRowCount(rowEl, Math.max(1, paths.length));
    const sels = rowEl.querySelectorAll(".mapper-src-opt");
    paths.forEach((p, i) => {
      if (sels[i]) {
        mapperEnsureSourceOption(sels[i], p);
        sels[i].value = p;
      }
    });
    for (let i = paths.length; i < sels.length; i++) {
      sels[i].value = "";
    }
  });
}

function guessSourceTypeByRouteSource(source) {
  const s = String(source || "").toLowerCase();
  if (s === "ocp" || s.includes("alertmanager")) return "ocp-alertmanager-4.20";
  if (s.includes("confluent")) return "confluent-8.10";
  return "";
}

function mappingsFromRouteTransform(route) {
  const t = (route && route.transform) || {};
  const rename = t.rename || {};
  const coalesce = t.coalesce_sources || {};
  const enrich = t.enrich_static || {};
  const concatMap = t.concat_templates || {};
  const template = (t.output_template && t.output_template.fields) || {};
  const reverseRename = {};
  Object.keys(rename).forEach((src) => {
    reverseRename[rename[src]] = src;
  });

  const targets = Object.keys(template);
  const mappings = targets.map((targetId) => {
    const selector = template[targetId];
    const staticVal = Object.prototype.hasOwnProperty.call(enrich, targetId) ? enrich[targetId] : null;
    const cspec = concatMap[targetId];
    if (cspec && (cspec.template != null && String(cspec.template).trim() !== "") && Array.isArray(cspec.paths) && cspec.paths.length) {
      return {
        target_field_id: targetId,
        concat_template: String(cspec.template),
        concat_paths: cspec.paths.map(String),
        source_field_id: null,
        static_value: null,
      };
    }
    if (staticVal != null && staticVal !== "") {
      return {
        target_field_id: targetId,
        source_field_id: null,
        static_value: staticVal,
      };
    }
    const coal = coalesce[targetId];
    if (Array.isArray(coal) && coal.length > 0) {
      return {
        target_field_id: targetId,
        source_field_ids: coal,
        source_field_id: null,
        static_value: null,
      };
    }
    let sourceId = reverseRename[targetId] || null;
    if (!sourceId && typeof selector === "string" && selector.startsWith("$.")) {
      const p = selector.slice(2);
      if (p && p !== targetId) sourceId = p;
    }
    return {
      target_field_id: targetId,
      source_field_id: sourceId,
      static_value: null,
    };
  });
  return mappings;
}

function loadActiveRouteMappingIntoForm() {
  updateMapperActivePatternDisplay();
  if (!configJson || !Array.isArray(configJson.routes)) return;
  if (!mapperApplyRoute) return;
  const routeName = mapperApplyRoute.value;
  if (!routeName) return;
  const route = configJson.routes.find((r) => r.name === routeName);
  if (!route) return;
  editorPatternId = route.active_pattern_id || null;
  const mappings = mappingsFromRouteTransform(route);
  if (!mappings.length) return;

  const targets = [...new Set(mappings.map((m) => m.target_field_id).filter(Boolean))].map((id) => ({ id, label: id }));
  if (targets.length) targetFieldsFromUpload = targets;

  const guessedSourceType = guessSourceTypeByRouteSource(route.match?.source);
  if (mapperSourceType && guessedSourceType) {
    mapperSourceType.value = guessedSourceType;
  }
  if (mapperPatternName && !mapperPatternName.value) {
    mapperPatternName.value = `active-${routeName}`;
  }

  renderMapperMappingTable();
  setMappingsToForm(mappings);
  if (mapperStatus) mapperStatus.textContent = `Loaded active mapping from route: ${routeName}`;
}

async function loadSavedPatterns() {
  if (!savedPatternsList) return;
  try {
    const res = await fetch("/api/patterns", { credentials: "include" });
    if (!res.ok) return;
    const list = await res.json();
    if (mapperLoadPatternSelect) {
      mapperLoadPatternSelect.innerHTML = `<option value="">${escapeHtml(tr("mapperSelectPatternPlaceholder"))}</option>` +
        list.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("");
    }
    const curRoute = mapperApplyRoute && mapperApplyRoute.value;
    savedPatternsList.innerHTML = list.length === 0
      ? `<li class="text-muted">${escapeHtml(tr("savedPatternsEmpty"))}</li>`
      : list.map((p) => {
          const activeRoutes = routesWherePatternActive(p.id);
          const badgeHtml = activeRoutes.length
            ? `<span class="pattern-active-badge" title="${escapeHtml(tr("patternActiveBadgeTitle"))}">${escapeHtml(tr("patternActiveBadge"))}: ${escapeHtml(activeRoutes.join(", "))}</span>`
            : "";
          const isLiveForDropdown = Boolean(curRoute && activeRoutes.includes(curRoute));
          const applyBtnClass = isLiveForDropdown
            ? "btn btn-secondary btn-apply-pattern btn-apply-is-live-for-route"
            : "btn btn-primary btn-apply-pattern";
          const applyLabel = isLiveForDropdown ? tr("mapperApplyToRouteBtnCurrent") : tr("mapperApplyToRouteBtn");
          return `
        <li class="saved-pattern-row">
          <div class="pattern-list-info">
            <div class="pattern-line-top">
              <span class="pattern-name">${escapeHtml(p.name)}</span>
              <span class="pattern-meta">${escapeHtml(p.source_type)}${p.updated_at ? ` · ${escapeHtml(fmtPatternTime(p.updated_at))}` : ""}</span>
            </div>
            ${badgeHtml ? `<div class="pattern-status-line">${badgeHtml}</div>` : ""}
          </div>
          <span class="pattern-actions">
            <button type="button" class="btn btn-secondary btn-display-pattern" data-id="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}" title="Show mapping">Display</button>
            <button type="button" class="btn btn-secondary btn-download-pattern" data-id="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}" title="Download as JSON">Download</button>
            <button type="button" class="btn btn-secondary btn-load-pattern" data-id="${escapeHtml(p.id)}">${escapeHtml(tr("mapperLoadIntoEditorBtn"))}</button>
            <button type="button" class="${applyBtnClass}" data-id="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}">${escapeHtml(applyLabel)}</button>
            <button type="button" class="btn btn-danger btn-delete-pattern" data-id="${escapeHtml(p.id)}" title="Delete pattern">Delete</button>
          </span>
        </li>`;
        }).join("");
    savedPatternsList.querySelectorAll(".btn-display-pattern").forEach((btn) => {
      btn.addEventListener("click", () => showPatternModal(btn.getAttribute("data-id"), btn.getAttribute("data-name")));
    });
    savedPatternsList.querySelectorAll(".btn-download-pattern").forEach((btn) => {
      btn.addEventListener("click", () => downloadPattern(btn.getAttribute("data-id"), btn.getAttribute("data-name")));
    });
    savedPatternsList.querySelectorAll(".btn-load-pattern").forEach((btn) => {
      btn.addEventListener("click", () => loadOnePattern(btn.getAttribute("data-id")));
    });
    savedPatternsList.querySelectorAll(".btn-apply-pattern").forEach((btn) => {
      btn.addEventListener("click", () => applyPatternById(btn.getAttribute("data-id"), btn.getAttribute("data-name")));
    });
    savedPatternsList.querySelectorAll(".btn-delete-pattern").forEach((btn) => {
      btn.addEventListener("click", () => deletePatternById(btn.getAttribute("data-id")));
    });
  } catch (err) {}
}

async function deletePatternById(patternId) {
  if (!patternId) return;
  if (!confirm("Delete this pattern?")) return;
  try {
    const res = await fetch(`/api/patterns/${patternId}`, { method: "DELETE", credentials: "include" });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Delete failed");
    }
    await loadSavedPatterns();
    if (mapperStatus) mapperStatus.textContent = "Pattern deleted.";
  } catch (e) {
    if (mapperStatus) mapperStatus.textContent = `Error: ${e.message}`;
  }
}

async function loadOnePattern(patternId) {
  try {
    const res = await fetch(`/api/patterns/${patternId}`, { credentials: "include" });
    if (!res.ok) return;
    const p = await res.json();
    editorPatternId = p.id || null;
    mapperPatternName.value = p.name || "";
    mapperSourceType.value = p.source_type || "";
    const mappings = p.mappings || [];
    const fromMappings = [...new Set(mappings.map((m) => m.target_field_id).filter(Boolean))].map((id) => ({ id, label: id }));
    if (fromMappings.length) targetFieldsFromUpload = fromMappings;
    onMapperSourceTypeChange();
    renderMapperMappingTable();
    let mergeToggled = false;
    if (mapperSourceType.value === "custom-paste") {
      mergeToggled = mapperAutoMergePresetsForMappings(mappings);
      onMapperSourceTypeChange();
    }
    setMappingsToForm(mappings);
    if (mapperStatus) {
      mapperStatus.textContent = mergeToggled ? tr("mapperPatternLoadedWithMerge") : tr("mapperPatternLoadedOk");
    }
  } catch (err) {
    if (mapperStatus) mapperStatus.textContent = "Failed to load pattern.";
  }
}

let currentDisplayPattern = null;

async function showPatternModal(patternId, patternName) {
  if (!patternId) return;
  try {
    const res = await fetch(`/api/patterns/${patternId}`, { credentials: "include" });
    if (!res.ok) return;
    const p = await res.json();
    currentDisplayPattern = p;
    const modal = document.getElementById("patternModal");
    const title = document.getElementById("patternModalTitle");
    const meta = document.getElementById("patternModalMeta");
    const body = document.getElementById("patternModalBody");
    title.textContent = escapeHtml(p.name || "Pattern Mapping");
    const tCreated = fmtPatternTime(p.created_at);
    const tUpdated = fmtPatternTime(p.updated_at);
    meta.textContent = `Source: ${escapeHtml(p.source_type || "—")}${tCreated ? ` | Created: ${tCreated}` : ""}${tUpdated ? ` | Updated: ${tUpdated}` : ""}`;
    const mappings = p.mappings || [];
    body.innerHTML = mappings.length === 0
      ? "<tr><td colspan=\"3\" class=\"text-muted\">No mappings.</td></tr>"
      : mappings.map((m) => {
          const target = escapeHtml(m.target_field_id || "—");
          let src = "—";
          if (m.static_value != null && m.static_value !== "") src = "—";
          else if (Array.isArray(m.source_field_ids) && m.source_field_ids.length) {
            src = m.source_field_ids.map((p) => `<code>${escapeHtml(String(p))}</code>`).join(" → ");
          } else if (m.source_field_id) src = `<code>${escapeHtml(m.source_field_id)}</code>`;
          const stat = m.static_value != null && m.static_value !== ""
            ? `<code>${escapeHtml(String(m.static_value))}</code>`
            : "—";
          return `<tr><td><code>${target}</code></td><td>${src}</td><td>${stat}</td></tr>`;
        }).join("");
    modal.style.display = "flex";
  } catch (err) {
    if (mapperStatus) mapperStatus.textContent = "Failed to load pattern.";
  }
}

function closePatternModal() {
  const modal = document.getElementById("patternModal");
  if (modal) modal.style.display = "none";
  currentDisplayPattern = null;
}

async function downloadPattern(patternId, patternName) {
  if (!patternId) return;
  try {
    const res = await fetch(`/api/patterns/${patternId}`, { credentials: "include" });
    if (!res.ok) throw new Error("Failed to fetch");
    const p = await res.json();
    const name = (patternName || p.name || "pattern").replace(/[^a-zA-Z0-9_-]/g, "_");
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name}_mapping.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    if (mapperStatus) mapperStatus.textContent = "Downloaded.";
  } catch (err) {
    if (mapperStatus) mapperStatus.textContent = "Failed to download.";
  }
}

async function applyPatternById(patternId, patternName) {
  const routeName = mapperApplyRoute && mapperApplyRoute.value;
  if (!routeName) {
    if (mapperStatus) mapperStatus.textContent = "Select a route first.";
    return;
  }
  try {
    const res = await fetch("/api/patterns/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ route_name: routeName, pattern_id: patternId }),
    });
    if (!res.ok) {
      let errMsg = "Apply failed";
      try {
        const err = await res.json();
        errMsg = err.detail || errMsg;
      } catch {
        const text = await res.text();
        errMsg = text || res.statusText || errMsg;
      }
      throw new Error(errMsg);
    }
    const pName = patternName || "Pattern";
    if (mapperStatus) mapperStatus.textContent = `${pName} applied to ${routeName} route. Reload config to see YAML.`;
    await loadConfig();
  } catch (e) {
    if (mapperStatus) mapperStatus.textContent = `Error: ${e.message}`;
  }
}

function renderMapperApplyRoutes(routes) {
  if (!mapperApplyRoute) return;
  const cur = mapperApplyRoute.value;
  const list = routes || [];
  const next = cur || (list.length ? list[0].name : "");
  mapperApplyRoute.innerHTML = "<option value=\"\">— Select route —</option>" +
    list.map((r) => `<option value="${escapeHtml(r.name)}" ${r.name === next ? "selected" : ""}>${escapeHtml(r.name)}</option>`).join("");
}

if (mapperSavePatternBtn) {
  mapperSavePatternBtn.addEventListener("click", async () => {
    const name = (mapperPatternName && mapperPatternName.value.trim()) || "";
    if (!name) {
      if (mapperStatus) mapperStatus.textContent = "Enter a pattern name before saving.";
      return;
    }
    const sourceType = mapperSourceType && mapperSourceType.value;
    if (!sourceType) {
      if (mapperStatus) mapperStatus.textContent = "Select an alert source first.";
      return;
    }
    const mappings = getMappingsFromForm();
    const check = mapperValidateMappingsForSave(mappings);
    if (!check.ok) {
      if (mapperStatus) mapperStatus.textContent = check.msg;
      return;
    }
    const payload = { name, source_type: sourceType, mappings };
    if (editorPatternId) payload.id = editorPatternId;
    try {
      const res = await fetch("/api/patterns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Save failed");
      const saved = await res.json();
      if (saved && saved.id) editorPatternId = saved.id;
      if (mapperStatus) mapperStatus.textContent = tr("mapperPatternSavedOk");
      await loadSavedPatterns();
    } catch (e) {
      if (mapperStatus) mapperStatus.textContent = `Error: ${e.message}`;
    }
  });
}

if (mapperParseTargetBtn && mapperTargetExample && mapperTargetPatternStatus) {
  mapperParseTargetBtn.addEventListener("click", () => {
    let jsonStr = mapperTargetExample.value.trim();
    if (!jsonStr) {
      mapperTargetPatternStatus.textContent = "Paste or upload JSON first.";
      return;
    }
    try {
      const data = JSON.parse(jsonStr);
      targetFieldsFromUpload = parseJsonToPaths(data);
      if (targetFieldsFromUpload.length === 0) {
        mapperTargetPatternStatus.textContent = "No fields found in JSON.";
        return;
      }
      // If we already have live payload as source, keep it so new table dropdowns get those options
      if (customSourceFields.length > 0 && mapperSourceType) mapperSourceType.value = "custom-paste";
      mapperTargetPatternStatus.textContent = `Parsed ${targetFieldsFromUpload.length} target field(s). You can map source → target below.`;
      renderMapperMappingTable();
    } catch (e) {
      mapperTargetPatternStatus.textContent = `Invalid JSON: ${e.message}`;
    }
  });
}

if (mapperTargetFile && mapperTargetExample) {
  mapperTargetFile.addEventListener("change", () => {
    const file = mapperTargetFile.files && mapperTargetFile.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      mapperTargetExample.value = r.result || "";
      mapperTargetFile.value = "";
    };
    r.readAsText(file, "UTF-8");
  });
}

if (mapperParseSourceBtn && document.getElementById("mapperSourceJsonRows")) {
  mapperParseSourceBtn.addEventListener("click", () => {
    mapperApplyParsedSourceFieldsFromRows();
  });
}

document.getElementById("mapperAddSourceJsonRowBtn")?.addEventListener("click", () => {
  mapperAppendSourceJsonRow("");
});

document.getElementById("mapperSourceJsonRows")?.addEventListener("click", (ev) => {
  const rm = ev.target.closest(".mapper-remove-json-row");
  if (!rm || rm.disabled) return;
  const row = rm.closest(".mapper-source-json-row");
  const wrap = document.getElementById("mapperSourceJsonRows");
  if (!row || !wrap || wrap.querySelectorAll(".mapper-source-json-row").length <= 1) return;
  row.remove();
  mapperSyncSourceJsonRowLabels();
  mapperUpdateAddJsonRowBtnState();
});

/** Extract payload pattern/structure (keys only, ignore values) for deduplication. */
function getPayloadPattern(payload) {
  if (!payload || typeof payload !== "object") return JSON.stringify(payload);
  if (Array.isArray(payload)) {
    if (payload.length === 0) return "[]";
    return "[" + payload.map((item) => getPayloadPattern(item)).join(",") + "]";
  }
  const keys = Object.keys(payload).sort();
  const pattern = {};
  for (const key of keys) {
    const val = payload[key];
    if (val === null || typeof val !== "object") {
      pattern[key] = typeof val;
    } else if (Array.isArray(val)) {
      pattern[key] = val.length > 0 ? `[${getPayloadPattern(val[0])}]` : "[]";
    } else {
      pattern[key] = getPayloadPattern(val);
    }
  }
  return JSON.stringify(pattern);
}

/** Filter payloads to show only unique patterns (first occurrence of each pattern). */
function deduplicatePayloadsByPattern(payloads) {
  const seenPatterns = new Set();
  const unique = [];
  for (const item of payloads) {
    if (!item.payload) continue;
    const pattern = getPayloadPattern(item.payload);
    if (!seenPatterns.has(pattern)) {
      seenPatterns.add(pattern);
      unique.push(item);
    }
  }
  return unique;
}

async function loadRecentPayloads() {
  if (!recentPayloadsList) return;
  try {
    const res = await fetch("/api/recent-payloads", { credentials: "include" });
    if (!res.ok) return;
    const list = await res.json();
    const allPayloads = Array.isArray(list) ? list : [];
    
    // Deduplicate by pattern - show only first occurrence of each pattern
    const uniquePayloads = deduplicatePayloadsByPattern(allPayloads);
    recentPayloadsCache = uniquePayloads;
    
    if (recentPayloadsList) {
      if (uniquePayloads.length === 0) {
        recentPayloadsList.innerHTML = "<li class=\"text-muted\">No incoming payloads yet. Send webhooks to /webhook/ocp or /webhook/confluent (or your route).</li>";
      } else {
        const totalCount = allPayloads.length;
        const uniqueCount = uniquePayloads.length;
        const dedupNote = totalCount > uniqueCount ? ` <span class="text-muted" style="font-size: 12px;">(${uniqueCount} unique patterns from ${totalCount} total)</span>` : "";
        
        recentPayloadsList.innerHTML = uniquePayloads.map((item, idx) =>
          `<li>
            <div class="payload-header">
              <span class="payload-ts">${escapeHtml(item.ts || "")}</span>
              <span class="payload-source">Source: <code>${escapeHtml(item.source || "")}</code></span>
              <span class="payload-route">Route: <strong>${escapeHtml(item.route || "")}</strong></span>
              <span class="payload-severity">${severityBadgeHtml(item.alert_severity)}</span>
            </div>
            <div class="payload-preview">
              <code class="payload-preview-code">${escapeHtml(JSON.stringify(item.payload || {}, null, 2))}</code>
            </div>
            <div class="payload-actions">
              <button type="button" class="btn btn-primary btn-use-payload" data-idx="${idx}">Use as source fields</button>
              <button type="button" class="btn btn-secondary btn-copy-payload-json" data-idx="${idx}" title="Copy JSON to clipboard">Copy JSON</button>
              <span class="payload-copy-feedback" data-idx="${idx}" style="display:none; margin-left: 6px; color: var(--accent); font-size: 12px;">Copied!</span>
            </div>
          </li>`
        ).join("") + (dedupNote ? `<li class="text-muted" style="padding: 8px; font-size: 12px; border: none;">${dedupNote}</li>` : "");
        recentPayloadsList.querySelectorAll(".btn-use-payload").forEach((btn) => {
          btn.addEventListener("click", () => usePayloadAsSource(parseInt(btn.getAttribute("data-idx"), 10)));
        });
        recentPayloadsList.querySelectorAll(".btn-copy-payload-json").forEach((btn) => {
          btn.addEventListener("click", () => copyPayloadJson(parseInt(btn.getAttribute("data-idx"), 10)));
        });
      }
    }
    if (recentPayloadsStatus) recentPayloadsStatus.textContent = "";
  } catch (err) {
    if (recentPayloadsStatus) recentPayloadsStatus.textContent = "Could not load recent payloads.";
  }
}

async function loadRecentSent() {
  if (!recentSentList) return;
  try {
    const res = await fetch("/api/recent-sent", { credentials: "include" });
    if (!res.ok) return;
    const list = await res.json();
    const items = Array.isArray(list) ? list : [];
    if (items.length === 0) {
      recentSentList.innerHTML = "<li class=\"text-muted\">No successfully forwarded payloads yet. Send webhooks and they will appear here after transform + forward.</li>";
    } else {
      recentSentList.innerHTML = items.map((item, idx) =>
        `<li class="recent-sent-item${idx === 0 ? " recent-sent-latest" : ""}">
          <div class="payload-header">
            <span class="payload-ts">${escapeHtml(item.ts || "")}</span>
            ${idx === 0 ? `<span class="recent-sent-latest-badge">${escapeHtml(tr("recentSentLatestBadge"))}</span>` : ""}
            <span class="payload-source">Source: <code>${escapeHtml(item.source || "")}</code></span>
            <span class="payload-route">Route: <strong>${escapeHtml(item.route || "")}</strong></span>
            <span class="payload-severity">${severityBadgeHtml(item.alert_severity)}</span>
          </div>
          <div class="payload-preview">
            <code class="payload-preview-code">${escapeHtml(JSON.stringify(item.transformed || {}, null, 2))}</code>
          </div>
        </li>`
      ).join("");
    }
    if (recentSentStatus) recentSentStatus.textContent = "";
  } catch (err) {
    if (recentSentStatus) recentSentStatus.textContent = "Could not load recent sent.";
  }
}

function copyPayloadJson(idx) {
  const item = recentPayloadsCache[idx];
  if (!item || item.payload === undefined) return;
  const text = JSON.stringify(item.payload, null, 2);
  navigator.clipboard.writeText(text).then(() => {
    const feedback = recentPayloadsList && recentPayloadsList.querySelector(`.payload-copy-feedback[data-idx="${idx}"]`);
    if (feedback) {
      feedback.style.display = "inline";
      feedback.textContent = "Copied!";
      setTimeout(() => { feedback.style.display = "none"; }, 2000);
    }
  }).catch(() => {
    if (mapperStatus) mapperStatus.textContent = "Copy failed. Try selecting the JSON manually.";
  });
}

function usePayloadAsSource(idx) {
  // idx is now the index in deduplicated list (recentPayloadsCache)
  const item = recentPayloadsCache[idx];
  if (!item || !item.payload) return;
  customSourceFields = parseJsonToPaths(item.payload);
  if (mapperSourceType) mapperSourceType.value = "custom-paste";
  mapperResetSourceJsonRowsToSingle(JSON.stringify(item.payload, null, 2));
  onMapperSourceTypeChange();
  // If user already parsed a target, re-render table so dropdowns get live payload options
  if (targetFieldsFromUpload.length > 0) renderMapperMappingTable();
  else fillMapperSourceOptionSelects();
  if (mapperStatus) mapperStatus.textContent = `Using ${customSourceFields.length} fields from live payload (${item.ts}, ${item.route}).`;
}

if (mapperLoadPatternBtn) {
  mapperLoadPatternBtn.addEventListener("click", () => {
    const id = mapperLoadPatternSelect && mapperLoadPatternSelect.value;
    if (id) loadOnePattern(id);
  });
}

if (mapperApplySavedToRouteBtn && mapperLoadPatternSelect) {
  mapperApplySavedToRouteBtn.addEventListener("click", () => {
    const id = mapperLoadPatternSelect.value;
    if (!id) {
      if (mapperStatus) mapperStatus.textContent = tr("mapperSelectSavedPatternFirst");
      return;
    }
    const opt = mapperLoadPatternSelect.options[mapperLoadPatternSelect.selectedIndex];
    const name = opt ? opt.textContent.trim() : "";
    applyPatternById(id, name);
  });
}

if (mapperApplyBtn) {
  mapperApplyBtn.addEventListener("click", async () => {
    const routeName = mapperApplyRoute && mapperApplyRoute.value;
    if (!routeName) {
      if (mapperStatus) mapperStatus.textContent = "Select a route first.";
      return;
    }
    const pName = (mapperPatternName && mapperPatternName.value.trim()) || "";
    if (!pName) {
      if (mapperStatus) mapperStatus.textContent = tr("mapperApplyPatternNameRequired");
      return;
    }
    const mappings = getMappingsFromForm();
    const applyCheck = mapperValidateMappingsForSave(mappings);
    if (!applyCheck.ok) {
      if (mapperStatus) mapperStatus.textContent = applyCheck.msg;
      return;
    }
    const applyBody = {
      route_name: routeName,
      source_type: mapperSourceType?.value || "",
      mappings,
      pattern_name: pName,
    };
    if (editorPatternId) applyBody.pattern_id = editorPatternId;
    try {
      const res = await fetch("/api/patterns/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(applyBody),
      });
      if (!res.ok) {
        let errMsg = "Apply failed";
        try {
          const err = await res.json();
          errMsg = err.detail || errMsg;
        } catch {
          const text = await res.text();
          errMsg = text || res.statusText || errMsg;
        }
        throw new Error(errMsg);
      }
      if (mapperStatus) {
        mapperStatus.textContent = tr("mapperApplyStatusLine").replace("{name}", pName).replace("{route}", routeName);
      }
      await loadConfig();
    } catch (e) {
      if (mapperStatus) mapperStatus.textContent = `Error: ${e.message}`;
    }
  });
}

if (mapperApplyRoute) {
  mapperApplyRoute.addEventListener("change", () => {
    loadActiveRouteMappingIntoForm();
    loadSavedPatterns();
  });
}

// Refresh immediately when tab becomes visible (avoids stale UI after background throttling)
function onVisibilityChange() {
  if (document.visibilityState === "visible") {
    loadStatsAndChart();
    loadLiveRequests();
    loadRecentSent();
    loadFailedEvents();
    loadEffectiveTargets();
    loadPortalStatus();
  }
}
document.addEventListener("visibilitychange", onVisibilityChange);

// ---------- API Keys ----------
async function loadApiKeys() {
  if (!apiKeysList) return;
  try {
    const res = await fetch("/api/api-keys", { credentials: "include" });
    if (!res.ok) {
      if (res.status === 401) {
        apiKeysList.innerHTML = "<li class=\"text-muted\">Login required. Refresh page and enter Basic Auth credentials.</li>";
      } else if (res.status === 404) {
        apiKeysList.innerHTML = "<li class=\"text-muted\">Endpoint not found. Make sure server is restarted with latest code.</li>";
      } else {
        const errText = await res.text();
        apiKeysList.innerHTML = `<li class=\"text-muted\">Load failed (${res.status}): ${escapeHtml(errText)}</li>`;
      }
      return;
    }
    const list = await res.json();
    if (!list || list.length === 0) {
      apiKeysList.innerHTML = "<li class=\"text-muted\">No API keys yet. Enter a name and click Gen API Key.</li>";
      return;
    }
    apiKeysList.innerHTML = list.map((k) => `
      <li>
        <span class="key-name">${escapeHtml(k.name)}</span>
        <span class="key-prefix">${escapeHtml(k.key_prefix || "")}</span>
        <span class="key-created">${escapeHtml(k.created_at || "")}</span>
        <button type="button" class="btn btn-secondary btn-delete-key" data-name="${escapeHtml(k.name)}">Delete</button>
      </li>
    `).join("");
    apiKeysList.querySelectorAll(".btn-delete-key").forEach((btn) => {
      btn.addEventListener("click", () => deleteApiKey(btn.getAttribute("data-name")));
    });
  } catch (err) {
    apiKeysList.innerHTML = `<li class=\"text-muted\">Could not load API keys: ${escapeHtml(err.message)}</li>`;
  }
}

async function deleteApiKey(name) {
  if (!name) return;
  if (!confirm(`Delete API key "${name}"? Clients using this key will be rejected.`)) return;
  try {
    const res = await fetch(`/api/api-keys/${encodeURIComponent(name)}`, { method: "DELETE", credentials: "include" });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Delete failed");
    }
    if (apiKeysStatus) apiKeysStatus.textContent = "Deleted.";
    await loadApiKeys();
  } catch (e) {
    if (apiKeysStatus) apiKeysStatus.textContent = `Error: ${e.message}`;
  }
}

if (genApiKeyBtn && apiKeyNameInput) {
  genApiKeyBtn.addEventListener("click", async () => {
    const name = apiKeyNameInput.value.trim();
    if (!name) {
      if (apiKeysStatus) apiKeysStatus.textContent = "Enter a name (e.g. ocp-prod).";
      return;
    }
    apiKeysStatus.textContent = "Generating...";
    if (apiKeyNewKeyBox) apiKeyNewKeyBox.style.display = "none";
    try {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        let errorMsg = "Generate failed";
        if (res.status === 401) {
          errorMsg = "Login required. Refresh page and enter Basic Auth credentials.";
        } else if (res.status === 404) {
          errorMsg = "Endpoint not found. Make sure server is restarted with latest code.";
        } else {
          try {
            const err = await res.json();
            errorMsg = err.detail || `HTTP ${res.status}`;
          } catch {
            errorMsg = `HTTP ${res.status}: ${await res.text()}`;
          }
        }
        throw new Error(errorMsg);
      }
      const data = await res.json();
      if (apiKeyNewKeyValue) apiKeyNewKeyValue.textContent = data.key || "";
      if (apiKeyNewKeyBox) apiKeyNewKeyBox.style.display = "block";
      apiKeysStatus.textContent = "Created. Copy the key above — it won’t be shown again.";
      await loadApiKeys();
    } catch (e) {
      if (apiKeysStatus) apiKeysStatus.textContent = `Error: ${e.message}`;
    }
  });
}

if (apiKeyCopyBtn && apiKeyNewKeyValue) {
  apiKeyCopyBtn.addEventListener("click", () => {
    const key = apiKeyNewKeyValue.textContent;
    if (!key) return;
    navigator.clipboard.writeText(key).then(() => {
      apiKeyCopyBtn.textContent = "Copied!";
      setTimeout(() => { apiKeyCopyBtn.textContent = "Copy"; }, 2000);
    }).catch(() => {});
  });
}

window.onLangChange = () => {
  if (configJson) {
    renderRoutes(configJson.routes || []);
    renderTargetUrls(configJson.routes || []);
  }
  updateMapperActivePatternDisplay();
  document.querySelectorAll(".mapper-src-opt-rows").forEach((wrap) => {
    wrap.querySelectorAll(".mapper-src-add-col").forEach((b) => {
      const t = tr("mapperAddSourceColumnAria");
      b.setAttribute("aria-label", t);
      b.title = t;
    });
    wrap.querySelectorAll(".mapper-src-remove-col").forEach((b) => {
      const t = tr("mapperRemoveSourceColumnAria");
      b.setAttribute("aria-label", t);
      b.title = t;
    });
  });
  mapperSyncSourceJsonRowLabels();
  mapperUpdateAddJsonRowBtnState();
  loadRecentSent();
  loadSavedPatterns();
  loadDlqPanel();
  loadPortalStatus();
};

function renderDlqTable() {
  const body = document.getElementById("dlqTableBody");
  const emptyEl = document.getElementById("dlqTableEmpty");
  if (!body || !emptyEl) return;
  const entries = dlqEntriesCache;
  const pageSize = dlqPageSize();
  const pageInfo = document.getElementById("dlqPageInfo");
  const prevBtn = document.getElementById("dlqPrevBtn");
  const nextBtn = document.getElementById("dlqNextBtn");
  const purgeSelBtn = document.getElementById("dlqPurgeSelectedBtn");
  const selPageEl = document.getElementById("dlqSelectPage");
  if (!entries.length) {
    body.innerHTML = "";
    emptyEl.style.display = "block";
    if (pageInfo) pageInfo.textContent = "0/0";
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    if (purgeSelBtn) purgeSelBtn.disabled = true;
    if (selPageEl) {
      selPageEl.checked = false;
      selPageEl.indeterminate = false;
    }
    return;
  }
  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  if (dlqPage > totalPages) dlqPage = totalPages;
  if (dlqPage < 1) dlqPage = 1;
  const start = (dlqPage - 1) * pageSize;
  const pagedEntries = entries.slice(start, start + pageSize);
  emptyEl.style.display = "none";
  const pageIds = pagedEntries.map((e) => dlqPurgeKey(e)).filter(Boolean);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => dlqSelectedIds.has(id));
  const somePageSelected = pageIds.some((id) => dlqSelectedIds.has(id));
  const rows = [];
  pagedEntries.forEach((e, localIdx) => {
    const i = start + localIdx;
    const errFull = e.error != null ? String(e.error) : "";
    const errShort = errFull.slice(0, 72);
    const errTrunc = errFull.length > 72;
    const open = dlqOpenDetailIndex === i;
    const btnLabel = open ? tr("dlqHideDetail") : tr("dlqShowDetail");
    const pkey = dlqPurgeKey(e);
    const canSel = !!pkey;
    const selChecked = canSel && dlqSelectedIds.has(pkey);
    const cbCell = canSel
      ? `<input type="checkbox" class="dlq-row-cb" data-dlq-key="${escapeHtml(pkey)}" ${selChecked ? "checked" : ""} />`
      : `<input type="checkbox" disabled title="${escapeHtml(tr("dlqNoIdHint"))}" />`;
    rows.push(`<tr class="dlq-row">
      <td class="dlq-cb-cell">${cbCell}</td>
      <td>${escapeHtml(e.ts || "")}</td>
      <td>${escapeHtml(e.source || "")}</td>
      <td>${escapeHtml(e.route || "")}</td>
      <td class="td-severity">${severityBadgeHtml(e.alert_severity)}</td>
      <td><code>${escapeHtml(e.request_id || "")}</code></td>
      <td class="failed-error-cell" title="${escapeHtml(errFull)}">${escapeHtml(errShort)}${errTrunc ? "…" : ""}</td>
      <td><button type="button" class="btn btn-secondary dlq-detail-btn" data-dlq-toggle="${i}" aria-expanded="${open}">${btnLabel}</button></td>
    </tr>`);
    rows.push(
      `<tr class="dlq-detail-row" data-dlq-detail-for="${i}" style="display:${open ? "table-row" : "none"};"><td colspan="${DLQ_TABLE_COLS}"><pre class="dlq-detail-pre">${escapeHtml(JSON.stringify(e, null, 2))}</pre></td></tr>`
    );
  });
  body.innerHTML = rows.join("");
  if (pageInfo) pageInfo.textContent = `${dlqPage}/${totalPages}`;
  if (prevBtn) prevBtn.disabled = dlqPage <= 1;
  if (nextBtn) nextBtn.disabled = dlqPage >= totalPages;
  if (purgeSelBtn) purgeSelBtn.disabled = dlqSelectedIds.size === 0;
  if (selPageEl) {
    selPageEl.checked = allPageSelected;
    selPageEl.indeterminate = somePageSelected && !allPageSelected;
    const stl = tr("dlqSelectPage");
    selPageEl.title = stl;
    selPageEl.setAttribute("aria-label", stl);
  }
}

function onDlqTableClick(ev) {
  const btn = ev.target.closest("[data-dlq-toggle]");
  if (!btn) return;
  const idx = parseInt(btn.getAttribute("data-dlq-toggle"), 10);
  if (Number.isNaN(idx)) return;
  if (dlqOpenDetailIndex === idx) {
    dlqOpenDetailIndex = null;
  } else {
    dlqOpenDetailIndex = idx;
  }
  renderDlqTable();
}

function onDlqListWrapChange(ev) {
  const t = ev.target;
  const pageSize = dlqPageSize();
  const entries = dlqEntriesCache;
  const start = (dlqPage - 1) * pageSize;
  const pagedEntries = entries.slice(start, start + pageSize);
  if (t && t.id === "dlqSelectPage") {
    const on = !!t.checked;
    pagedEntries.forEach((e) => {
      const id = dlqPurgeKey(e);
      if (!id) return;
      if (on) dlqSelectedIds.add(id);
      else dlqSelectedIds.delete(id);
    });
    renderDlqTable();
    return;
  }
  if (t && t.classList && t.classList.contains("dlq-row-cb") && t.dataset.dlqKey) {
    const id = String(t.dataset.dlqKey);
    if (t.checked) dlqSelectedIds.add(id);
    else dlqSelectedIds.delete(id);
    renderDlqTable();
  }
}

async function purgeDlqSelected() {
  const ids = [...dlqSelectedIds];
  if (!ids.length) {
    window.alert(tr("dlqPurgeNoneSelected"));
    return;
  }
  if (!window.confirm(tr("dlqConfirmPurgeSelected"))) return;
  const statusEl = document.getElementById("dlqStatus");
  if (statusEl) statusEl.textContent = tr("dlqLoading");
  try {
    const res = await fetch("/api/dlq/purge", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      if (statusEl) statusEl.textContent = tr("dlqLogin");
      return;
    }
    if (!res.ok || !data.ok) {
      if (statusEl) statusEl.textContent = data.detail || `HTTP ${res.status}`;
      return;
    }
    dlqSelectedIds.clear();
    if (statusEl) statusEl.textContent = `${tr("dlqPurgeOk")} (${data.removed ?? 0})`;
    await refreshDlq();
  } catch (e) {
    if (statusEl) statusEl.textContent = String(e);
  }
}

async function purgeDlqAll() {
  if (!window.confirm(tr("dlqConfirmPurgeAll"))) return;
  const statusEl = document.getElementById("dlqStatus");
  if (statusEl) statusEl.textContent = tr("dlqLoading");
  try {
    const res = await fetch("/api/dlq/purge", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      if (statusEl) statusEl.textContent = tr("dlqLogin");
      return;
    }
    if (!res.ok || !data.ok) {
      if (statusEl) statusEl.textContent = data.detail || `HTTP ${res.status}`;
      return;
    }
    dlqSelectedIds.clear();
    if (statusEl) statusEl.textContent = tr("dlqPurgeOk");
    await refreshDlq();
  } catch (e) {
    if (statusEl) statusEl.textContent = String(e);
  }
}

async function loadDlqPanel() {
  const disabled = document.getElementById("dlqDisabled");
  const disabledMsg = document.getElementById("dlqDisabledMsg");
  const panel = document.getElementById("dlqPanel");
  const statusEl = document.getElementById("dlqStatus");
  if (!disabled || !panel) return;
  try {
    const res = await fetch("/api/dlq/recent?limit=1", { credentials: "include" });
    if (res.status === 401) {
      disabled.style.display = "block";
      panel.style.display = "none";
      if (disabledMsg) disabledMsg.textContent = tr("dlqLogin");
      if (statusEl) statusEl.textContent = "";
      dlqEntriesCache = [];
      dlqOpenDetailIndex = null;
      dlqSelectedIds.clear();
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 503 && data.configured === false) {
      disabled.style.display = "block";
      panel.style.display = "none";
      if (disabledMsg) disabledMsg.textContent = tr("dlqOff");
      if (statusEl) statusEl.textContent = "";
      dlqEntriesCache = [];
      dlqOpenDetailIndex = null;
      dlqSelectedIds.clear();
      return;
    }
    disabled.style.display = "none";
    panel.style.display = "block";
    await refreshDlq();
  } catch {
    disabled.style.display = "block";
    panel.style.display = "none";
    if (disabledMsg) disabledMsg.textContent = tr("dlqOff");
    dlqEntriesCache = [];
    dlqOpenDetailIndex = null;
    dlqSelectedIds.clear();
  }
}

async function refreshDlq() {
  const statusEl = document.getElementById("dlqStatus");
  const pageSize = dlqPageSize();
  const lim = String(Math.min(500, Math.max(50, pageSize * 10)));
  if (statusEl) statusEl.textContent = tr("dlqLoading");
  dlqOpenDetailIndex = null;
  dlqPage = 1;
  try {
    const res = await fetch(`/api/dlq/recent?limit=${encodeURIComponent(lim)}`, { credentials: "include" });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      if (statusEl) statusEl.textContent = tr("dlqLogin");
      return;
    }
    if (!res.ok) {
      if (statusEl) statusEl.textContent = data.detail || `HTTP ${res.status}`;
      dlqEntriesCache = [];
      renderDlqTable();
      return;
    }
    const entries = data.entries || [];
    dlqEntriesCache = entries;
    const presentIds = new Set(entries.map((e) => dlqPurgeKey(e)).filter(Boolean));
    dlqSelectedIds.forEach((id) => {
      if (!presentIds.has(id)) dlqSelectedIds.delete(id);
    });
    if (statusEl) statusEl.textContent = `${tr("dlqDone")} · ${entries.length}`;
    renderDlqTable();
  } catch (e) {
    if (statusEl) statusEl.textContent = String(e);
    dlqEntriesCache = [];
    renderDlqTable();
  }
}

document.querySelector(".lang-toggle")?.addEventListener("click", (e) => {
  const btn = e.target.closest("button.lang-btn");
  if (!btn || !window.setLang) return;
  if (btn.id === "langEn") window.setLang("en");
  if (btn.id === "langTh") window.setLang("th");
});

loadConfig();
loadPatternSchemas();
/** Table listeners must not depend on /api/pattern-schemas succeeding (auth/network). */
attachMapperMergeAndOptionListeners();
loadRecentPayloads();
loadApiKeys();
loadHeaderVersion();
setInterval(loadRecentPayloads, 5000);
loadStatsAndChart();
setInterval(loadStatsAndChart, 2500);
loadLiveRequests();
loadFailedEvents();
setInterval(loadLiveRequests, 2500);
setInterval(loadFailedEvents, 2500);
loadRecentSent();
setInterval(loadRecentSent, 2500);
setInterval(loadEffectiveTargets, 5000);
setInterval(loadPortalStatus, 8000);
setInterval(loadDailyMetrics, 30000);
loadDailyMetrics();

document.getElementById("dlqRefreshBtn")?.addEventListener("click", () => { refreshDlq(); });
document.getElementById("dlqLimit")?.addEventListener("change", () => { refreshDlq(); });
document.getElementById("dlqPurgeSelectedBtn")?.addEventListener("click", () => { purgeDlqSelected(); });
document.getElementById("dlqPurgeAllBtn")?.addEventListener("click", () => { purgeDlqAll(); });
document.getElementById("dlqListWrap")?.addEventListener("click", onDlqTableClick);
document.getElementById("dlqListWrap")?.addEventListener("change", onDlqListWrapChange);
document.getElementById("dlqPrevBtn")?.addEventListener("click", () => { dlqPage = Math.max(1, dlqPage - 1); renderDlqTable(); });
document.getElementById("dlqNextBtn")?.addEventListener("click", () => { dlqPage += 1; renderDlqTable(); });
document.getElementById("livePageSize")?.addEventListener("change", () => { livePage = 1; renderLiveRequests(liveRequestsCache); });
document.getElementById("livePrevBtn")?.addEventListener("click", () => { livePage = Math.max(1, livePage - 1); renderLiveRequests(liveRequestsCache); });
document.getElementById("liveNextBtn")?.addEventListener("click", () => { livePage += 1; renderLiveRequests(liveRequestsCache); });
document.getElementById("failedPageSize")?.addEventListener("change", () => { failedPage = 1; renderFailedEvents(failedEventsCache); });
document.getElementById("failedPrevBtn")?.addEventListener("click", () => { failedPage = Math.max(1, failedPage - 1); renderFailedEvents(failedEventsCache); });
document.getElementById("failedNextBtn")?.addEventListener("click", () => { failedPage += 1; renderFailedEvents(failedEventsCache); });
document.getElementById("dailyRefreshBtn")?.addEventListener("click", () => { loadDailyMetrics(); });
document.getElementById("dailyDays")?.addEventListener("change", () => { loadDailyMetrics(); });

if (failedEventsSearch) {
  failedEventsSearch.addEventListener("input", () => { failedPage = 1; renderFailedEvents(failedEventsCache); });
}

const patternModal = document.getElementById("patternModal");
if (patternModal) {
  patternModal.querySelector(".pattern-modal-backdrop")?.addEventListener("click", closePatternModal);
  patternModal.querySelector(".pattern-modal-close")?.addEventListener("click", closePatternModal);
  patternModal.querySelector(".pattern-modal-close-btn")?.addEventListener("click", closePatternModal);
  const modalDownloadBtn = document.getElementById("patternModalDownloadBtn");
  if (modalDownloadBtn) {
    modalDownloadBtn.addEventListener("click", () => {
      if (currentDisplayPattern) {
        downloadPattern(currentDisplayPattern.id, currentDisplayPattern.name);
      }
    });
  }
}

if (window.applyI18n) window.applyI18n();
mapperSyncSourceJsonRowLabels();
mapperUpdateAddJsonRowBtnState();
loadPortalStatus();
loadDlqPanel();
