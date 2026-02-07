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
const mapperSourceExample = document.getElementById("mapperSourceExample");
const mapperParseSourceBtn = document.getElementById("mapperParseSourceBtn");
const portalStatus = document.getElementById("portalStatus");
const portalStatusText = document.getElementById("portalStatusText");
const targetFwdStatus = document.getElementById("targetFwdStatus");
const targetFwdStatusText = document.getElementById("targetFwdStatusText");
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
let targetsCache = [];
let targetStatusCache = { routes: [] };

function tr(key) {
  const fn = (typeof window !== "undefined" && window.t) ? window.t : (k => k);
  return fn(key);
}

const RATE_HISTORY_MAX = 90;
let patternSchemas = { source_schemas: {}, target_fields: [] };
let targetFieldsFromUpload = [];
let customSourceFields = [];
let rateHistory = [];
let lastTotalRequests = null;
let configJson = null;

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

async function loadConfig() {
  configStatus.textContent = "Loading...";
  try {
    const [yamlRes, jsonRes] = await Promise.all([
      fetch("/api/config", { headers: { Accept: "text/yaml" }, credentials: "include" }),
      fetch("/api/config", { credentials: "include" }),
    ]);

    if (!yamlRes.ok || !jsonRes.ok) {
      throw new Error("Failed to load config");
    }

    const yamlText = await yamlRes.text();
    configTextarea.value = yamlText;

    const jsonData = await jsonRes.json();
    configJson = JSON.parse(JSON.stringify(jsonData));
    renderRoutes(jsonData.routes || []);
    renderTargetUrls(jsonData.routes || []);
    renderMapperApplyRoutes(jsonData.routes || []);
    await loadEffectiveTargets();
    configStatus.textContent = "Loaded";
  } catch (error) {
    configStatus.textContent = `Error: ${error.message}`;
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
    if (st && r.target_url !== "(not set)") {
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
      routes.forEach((route) => {
        const source = route.match?.source || "";
        const endpoint = `/webhook/${source}`;
        const fullUrl = `${baseUrl}${endpoint}`;
        html += `<div class="client-url-box">`;
        html += `<code class="client-url">${escapeHtml(fullUrl)}</code>`;
        html += `<button type="button" class="btn btn-secondary btn-copy-url" data-url="${escapeHtml(fullUrl)}">Copy</button>`;
        html += `</div>`;
      });
      
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
    configJson.routes.forEach((route) => {
      if (!route.target) route.target = {};
      const routeName = route.name;
      
      // URL
      const urlInput = targetUrlsPanel.querySelector(`input[data-route-name="${routeName}"][data-field="url"]`);
      route.target.url = urlInput ? urlInput.value.trim() || null : null;
      
      // API Key Header
      const headerSelect = targetUrlsPanel.querySelector(`select[data-route-name="${routeName}"][data-field="api_key_header"]`);
      route.target.api_key_header = headerSelect && headerSelect.value ? headerSelect.value : null;
      
      // API Key Value
      const apiKeyInput = targetUrlsPanel.querySelector(`input[data-route-name="${routeName}"][data-field="api_key"]`);
      route.target.api_key = apiKeyInput && apiKeyInput.value.trim() ? apiKeyInput.value.trim() : null;
      
      // API Key Env Var
      const apiKeyEnvInput = targetUrlsPanel.querySelector(`input[data-route-name="${routeName}"][data-field="api_key_env"]`);
      route.target.api_key_env = apiKeyEnvInput && apiKeyEnvInput.value.trim() ? apiKeyEnvInput.value.trim() : null;

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
      targetUrlsStatus.textContent = "Saved & reloaded. If forward still fails, run: python scripts/mock_receiver.py";
    } else {
      targetUrlsStatus.textContent = "Saved (reload failed). Try Reload button.";
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
  ctx.fillStyle = "rgba(34, 197, 94, 0.15)";
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.strokeStyle = "#22c55e";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
}

function setPortalStatus(online) {
  if (!portalStatus || !portalStatusText) return;
  portalStatus.classList.remove("online", "offline");
  portalStatus.classList.add(online ? "online" : "offline");
  portalStatusText.textContent = online ? "Portal online" : "Portal offline";
}

function setTargetFwdStatus(hasTarget, online, okCount, totalCount) {
  if (!targetFwdStatus || !targetFwdStatusText) return;
  if (!hasTarget) {
    targetFwdStatus.style.display = "none";
    return;
  }
  targetFwdStatus.style.display = "";
  targetFwdStatus.classList.remove("online", "offline", "partial");
  if (online) {
    targetFwdStatus.classList.add("online");
  } else if (okCount != null && totalCount != null && okCount > 0) {
    targetFwdStatus.classList.add("partial");
  } else {
    targetFwdStatus.classList.add("offline");
  }
  let text = online ? tr("targetFwdOnline") : tr("targetFwdOffline");
  if (totalCount != null && totalCount > 1) {
    text = `Target Fwd: ${okCount}/${totalCount} OK`;
  }
  targetFwdStatusText.textContent = text;
}

async function loadTargetFwdStatus() {
  try {
    const response = await fetch("/api/target-status", { credentials: "include" });
    if (!response.ok) return;
    const data = await response.json();
    targetStatusCache = { routes: data.routes || [], has_any_target: data.has_any_target, all_ok: data.all_ok };
    const configured = (data.routes || []).filter((r) => r.target_url && r.target_url !== "(not set)");
    const okCount = configured.filter((r) => r.phase1_ok && r.phase2_ok).length;
    setTargetFwdStatus(data.has_any_target || false, data.all_ok || false, okCount, configured.length);
    if (targetsCache.length) renderTargetUrlsEffective(targetsCache, targetStatusCache.routes);
  } catch (err) {
    if (targetFwdStatus) targetFwdStatus.style.display = "none";
  }
}

async function loadStatsAndChart() {
  try {
    const response = await fetch("/api/stats", { credentials: "include" });
    if (!response.ok) {
      setPortalStatus(false);
      if (statsStatus) statsStatus.textContent = "Could not load count";
      return;
    }
    setPortalStatus(true);
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
    setPortalStatus(false);
    if (statsStatus) statsStatus.textContent = "Failed to load count";
  }
}

function renderLiveRequests(list) {
  if (!liveRequestsBody || !liveRequestsEmpty) return;
  if (!list || list.length === 0) {
    liveRequestsBody.innerHTML = "";
    liveRequestsEmpty.style.display = "block";
    return;
  }
  liveRequestsEmpty.style.display = "none";
  liveRequestsBody.innerHTML = list
    .map(
      (r) =>
        `<tr>
          <td>${escapeHtml(r.ts || "")}</td>
          <td>${escapeHtml(r.source || "")}</td>
          <td>${escapeHtml(r.route || "")}</td>
          <td class="live-alert-summary" title="${escapeHtml(r.alert_summary || "")}">${escapeHtml((r.alert_summary || "-").slice(0, 60))}${(r.alert_summary || "").length > 60 ? "…" : ""}</td>
          <td class="status-${r.http_status || ""}">${escapeHtml(String(r.http_status || ""))}</td>
          <td class="${r.forwarded ? "forwarded-ok" : "forwarded-fail"}">${r.forwarded ? "yes" : "no"}</td>
          <td><code>${escapeHtml((r.request_id || "").slice(0, 8))}</code></td>
        </tr>`
    )
    .join("");
}
function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

async function loadLiveRequests() {
  try {
    const response = await fetch("/api/recent-requests", { credentials: "include" });
    if (!response.ok) return;
    const data = await response.json();
    renderLiveRequests(Array.isArray(data) ? data : []);
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
    return src.includes(ql) || route.includes(ql) || rid.includes(ql) || err.includes(ql) || preview.includes(ql);
  });
}

const FAILED_EVENTS_DISPLAY_LIMIT = 20;

function renderFailedEvents(list) {
  if (!failedEventsBody || !failedEventsEmpty) return;
  const q = failedEventsSearch ? failedEventsSearch.value.trim() : "";
  const filtered = filterFailedEvents(list, q);
  const toShow = filtered.slice(0, FAILED_EVENTS_DISPLAY_LIMIT);
  if (!toShow.length) {
    failedEventsBody.innerHTML = "";
    failedEventsEmpty.style.display = "block";
    failedEventsEmpty.textContent = q
      ? tr("noMatchesForSearch")
      : tr("failedEmpty");
    return;
  }
  failedEventsEmpty.style.display = "none";
  failedEventsBody.innerHTML = toShow
    .map((r) =>
      `<tr>
        <td>${escapeHtml(r.ts || "")}</td>
        <td>${escapeHtml(r.source || "")}</td>
        <td>${escapeHtml(r.route || "")}</td>
        <td class="status-${r.http_status || ""}">${escapeHtml(String(r.http_status || ""))}</td>
        <td><code>${escapeHtml((r.request_id || "").slice(0, 8))}</code></td>
        <td class="failed-error-cell" title="${escapeHtml(r.error || "")}">${escapeHtml((r.error || r.payload_preview || "").slice(0, 60))}${(r.error || r.payload_preview || "").length > 60 ? "…" : ""}</td>
      </tr>`
    )
    .join("");
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
  const id = mapperSourceType.value;
  if (!mapperSourceDescription || !mapperSourceFields) return;
  if (mapperSourceCustomWrap) mapperSourceCustomWrap.style.display = id === "custom-paste" ? "flex" : "none";
  if (!id) {
    mapperSourceDescription.textContent = "";
    mapperSourceFields.innerHTML = "";
    return;
  }
  if (id === "custom-paste") {
    mapperSourceDescription.textContent = "Paste an example incoming log (JSON) below, then click Use as source fields.";
    if (customSourceFields.length) {
      mapperSourceFields.innerHTML = customSourceFields.map((f) =>
        `<li data-field-id="${escapeHtml(f.id)}">${escapeHtml(f.label)}</li>`
      ).join("");
    } else {
      mapperSourceFields.innerHTML = "<li class=\"text-muted\">Paste JSON and click \"Use as source fields\".</li>";
    }
    fillMapperSourceDropdowns();
    return;
  }
  const schema = (patternSchemas.source_schemas || {})[id];
  if (schema) {
    mapperSourceDescription.textContent = schema.description || "";
    mapperSourceFields.innerHTML = (schema.fields || []).map((f) =>
      `<li data-field-id="${escapeHtml(f.id)}">${escapeHtml(f.label)}</li>`
    ).join("");
    fillMapperSourceDropdowns();
  } else {
    mapperSourceDescription.textContent = "";
    mapperSourceFields.innerHTML = "";
  }
}

function renderMapperMappingTable() {
  if (!mapperMappingBody) return;
  const targets = targetFieldsFromUpload.length > 0 ? targetFieldsFromUpload : (patternSchemas.target_fields || []);
  mapperMappingBody.innerHTML = targets.map((t) => {
    const sid = `map-src-${t.id}`;
    const vid = `map-val-${t.id}`;
    return `<tr data-target-id="${escapeHtml(t.id)}">
      <td><strong>${escapeHtml(t.label)}</strong></td>
      <td><select id="${sid}" class="mapper-src-select" data-target-id="${escapeHtml(t.id)}"><option value="">—</option></select></td>
      <td><input type="text" id="${vid}" class="mapper-static-input" data-target-id="${escapeHtml(t.id)}" placeholder="optional static" /></td>
    </tr>`;
  }).join("");
  onMapperSourceTypeChange();
  fillMapperSourceDropdowns();
}

function fillMapperSourceDropdowns() {
  const id = mapperSourceType.value;
  const sourceFields = id === "custom-paste" ? customSourceFields : ((patternSchemas.source_schemas || {})[id]?.fields || []);
  if (!mapperMappingBody) return;
  mapperMappingBody.querySelectorAll(".mapper-src-select").forEach((sel) => {
    const targetId = sel.getAttribute("data-target-id");
    const current = sel.value;
    sel.innerHTML = "<option value=\"\">—</option>" + sourceFields.map((f) =>
      `<option value="${escapeHtml(f.id)}" ${f.id === current ? "selected" : ""}>${escapeHtml(f.label)}</option>`
    ).join("");
  });
}

function getMappingsFromForm() {
  const mappings = [];
  if (!mapperMappingBody) return mappings;
  mapperMappingBody.querySelectorAll("tr[data-target-id]").forEach((tr) => {
    const targetId = tr.getAttribute("data-target-id");
    const sel = tr.querySelector(".mapper-src-select");
    const input = tr.querySelector(".mapper-static-input");
    const sourceId = sel ? sel.value : "";
    const staticVal = input ? input.value.trim() : "";
    mappings.push({
      target_field_id: targetId,
      source_field_id: sourceId || null,
      static_value: staticVal || null,
    });
  });
  return mappings;
}

function setMappingsToForm(mappings) {
  if (!mapperMappingBody) return;
  (mappings || []).forEach((m) => {
    const sel = mapperMappingBody.querySelector(`.mapper-src-select[data-target-id="${m.target_field_id}"]`);
    const input = mapperMappingBody.querySelector(`.mapper-static-input[data-target-id="${m.target_field_id}"]`);
    if (sel) sel.value = m.source_field_id || "";
    if (input) input.value = m.static_value || "";
  });
}

async function loadSavedPatterns() {
  if (!savedPatternsList) return;
  try {
    const res = await fetch("/api/patterns", { credentials: "include" });
    if (!res.ok) return;
    const list = await res.json();
    if (mapperLoadPatternSelect) {
      mapperLoadPatternSelect.innerHTML = "<option value=\"\">— Select pattern —</option>" +
        list.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("");
    }
    savedPatternsList.innerHTML = list.length === 0
      ? "<li class=\"text-muted\">No saved patterns. Map fields above, enter a name, and click Save as pattern.</li>"
      : list.map((p) => `
        <li>
          <span class="pattern-name">${escapeHtml(p.name)}</span>
          <span class="pattern-meta">${escapeHtml(p.source_type)}</span>
          <span class="pattern-actions">
            <button type="button" class="btn btn-secondary btn-display-pattern" data-id="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}" title="Show mapping">Display</button>
            <button type="button" class="btn btn-secondary btn-download-pattern" data-id="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}" title="Download as JSON">Download</button>
            <button type="button" class="btn btn-secondary btn-load-pattern" data-id="${escapeHtml(p.id)}">Load</button>
            <button type="button" class="btn btn-primary btn-apply-pattern" data-id="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}">Apply to route</button>
            <button type="button" class="btn btn-danger btn-delete-pattern" data-id="${escapeHtml(p.id)}" title="Delete pattern">Delete</button>
          </span>
        </li>
      `).join("");
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
    mapperPatternName.value = p.name || "";
    mapperSourceType.value = p.source_type || "";
    const mappings = p.mappings || [];
    const fromMappings = [...new Set(mappings.map((m) => m.target_field_id).filter(Boolean))].map((id) => ({ id, label: id }));
    if (fromMappings.length) targetFieldsFromUpload = fromMappings;
    onMapperSourceTypeChange();
    renderMapperMappingTable();
    fillMapperSourceDropdowns();
    setMappingsToForm(mappings);
    if (mapperStatus) mapperStatus.textContent = "Pattern loaded.";
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
    meta.textContent = `Source: ${escapeHtml(p.source_type || "—")}`;
    const mappings = p.mappings || [];
    body.innerHTML = mappings.length === 0
      ? "<tr><td colspan=\"3\" class=\"text-muted\">No mappings.</td></tr>"
      : mappings.map((m) => {
          const target = escapeHtml(m.target_field_id || "—");
          const src = m.source_field_id ? `<code>${escapeHtml(m.source_field_id)}</code>` : "—";
          const stat = m.static_value ? `<code>${escapeHtml(m.static_value)}</code>` : "—";
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
      const err = await res.json();
      throw new Error(err.detail || "Apply failed");
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
  mapperApplyRoute.innerHTML = "<option value=\"\">— Select route —</option>" +
    (routes || []).map((r) => `<option value="${escapeHtml(r.name)}" ${r.name === cur ? "selected" : ""}>${escapeHtml(r.name)}</option>`).join("");
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
    try {
      const res = await fetch("/api/patterns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, source_type: sourceType, mappings }),
      });
      if (!res.ok) throw new Error("Save failed");
      if (mapperStatus) mapperStatus.textContent = "Pattern saved.";
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

if (mapperParseSourceBtn && mapperSourceExample) {
  mapperParseSourceBtn.addEventListener("click", () => {
    const jsonStr = mapperSourceExample.value.trim();
    if (!jsonStr) return;
    try {
      const data = JSON.parse(jsonStr);
      customSourceFields = parseJsonToPaths(data);
      if (customSourceFields.length === 0) {
        customSourceFields = [];
        onMapperSourceTypeChange();
        return;
      }
      onMapperSourceTypeChange();
      if (mapperStatus) mapperStatus.textContent = `Parsed ${customSourceFields.length} source field(s).`;
    } catch (e) {
      if (mapperStatus) mapperStatus.textContent = `Invalid JSON: ${e.message}`;
    }
  });
}

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
            </div>
            <div class="payload-preview">
              <code class="payload-preview-code">${escapeHtml(JSON.stringify(item.payload || {}, null, 2))}</code>
            </div>
            <button type="button" class="btn btn-primary btn-use-payload" data-idx="${idx}">Use as source fields</button>
          </li>`
        ).join("") + (dedupNote ? `<li class="text-muted" style="padding: 8px; font-size: 12px; border: none;">${dedupNote}</li>` : "");
        recentPayloadsList.querySelectorAll(".btn-use-payload").forEach((btn) => {
          btn.addEventListener("click", () => usePayloadAsSource(parseInt(btn.getAttribute("data-idx"), 10)));
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
      recentSentList.innerHTML = items.map((item) =>
        `<li>
          <div class="payload-header">
            <span class="payload-ts">${escapeHtml(item.ts || "")}</span>
            <span class="payload-source">Source: <code>${escapeHtml(item.source || "")}</code></span>
            <span class="payload-route">Route: <strong>${escapeHtml(item.route || "")}</strong></span>
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

function usePayloadAsSource(idx) {
  // idx is now the index in deduplicated list (recentPayloadsCache)
  const item = recentPayloadsCache[idx];
  if (!item || !item.payload) return;
  customSourceFields = parseJsonToPaths(item.payload);
  if (mapperSourceType) mapperSourceType.value = "custom-paste";
  if (mapperSourceExample) mapperSourceExample.value = JSON.stringify(item.payload, null, 2);
  onMapperSourceTypeChange();
  fillMapperSourceDropdowns();
  if (mapperStatus) mapperStatus.textContent = `Using ${customSourceFields.length} fields from live payload (${item.ts}, ${item.route}).`;
}

if (mapperLoadPatternBtn) {
  mapperLoadPatternBtn.addEventListener("click", () => {
    const id = mapperLoadPatternSelect && mapperLoadPatternSelect.value;
    if (id) loadOnePattern(id);
  });
}

if (mapperApplyBtn) {
  mapperApplyBtn.addEventListener("click", async () => {
    const routeName = mapperApplyRoute && mapperApplyRoute.value;
    if (!routeName) {
      if (mapperStatus) mapperStatus.textContent = "Select a route first.";
      return;
    }
    const mappings = getMappingsFromForm();
    const pName = (mapperPatternName && mapperPatternName.value.trim()) || "Current mapping";
    try {
      const res = await fetch("/api/patterns/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          route_name: routeName,
          source_type: mapperSourceType?.value || "",
          mappings,
          pattern_name: pName,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Apply failed");
      }
      if (mapperStatus) mapperStatus.textContent = `${pName} applied to ${routeName} route. Pattern saved. Reload config to see YAML.`;
      await loadConfig();
      await loadSavedPatterns();
    } catch (e) {
      if (mapperStatus) mapperStatus.textContent = `Error: ${e.message}`;
    }
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
    loadTargetFwdStatus();
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
};

document.querySelector(".lang-toggle")?.addEventListener("click", (e) => {
  const btn = e.target.closest("button.lang-btn");
  if (!btn || !window.setLang) return;
  if (btn.id === "langEn") window.setLang("en");
  if (btn.id === "langTh") window.setLang("th");
});

loadConfig();
loadPatternSchemas();
loadSavedPatterns();
loadRecentPayloads();
loadApiKeys();
setInterval(loadRecentPayloads, 5000);
loadStatsAndChart();
setInterval(loadStatsAndChart, 1000);
loadLiveRequests();
loadFailedEvents();
loadTargetFwdStatus();
setInterval(loadLiveRequests, 1500);
setInterval(loadFailedEvents, 1500);
loadRecentSent();
setInterval(loadRecentSent, 1500);
setInterval(loadEffectiveTargets, 3000);
setInterval(loadTargetFwdStatus, 5000);

if (failedEventsSearch) {
  failedEventsSearch.addEventListener("input", () => renderFailedEvents(failedEventsCache));
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
