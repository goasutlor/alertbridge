# Changelog

All notable changes to this project are documented in this file. The format is inspired by [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

<!-- Upcoming changes go here before release tagging. -->

### Changed

- **Config still listing `confluent` routes:** On load and before `PUT /api/config` persist, routes with `match.source: confluent` are **dropped** so the UI (Target URLs, Client Info, forward summary) stays **OCP-only** even if a ConfigMap still contains `confluent-alerts`. Saving from the UI writes YAML without them; `POST /webhook/confluent` then **404** (no matching route).
- **Documentation & copy:** Aligned **ARCHITECTURE**, **FEATURES**, **VA_TEST**, **OCP_DEPLOY**, Field Mapper i18n, and `docs/TARGET_PATTERN_EXAMPLES.json` with a **single inbound source** (`POST /webhook/ocp`); removed remaining “two routes / Confluent” wording outside historical changelog notes.
- **UI (Live / Failed / DLQ):** Removed **Route** column (single inbound path `/webhook/ocp`). **DLQ** adds **Alert(s)** with the same preview/tooltip as Live (`alert_bundle_preview` / `alert_bundle_detail` stored per DLQ row; legacy rows backfilled from `transformed` when possible).
- **Confluent route removed:** Dropped `confluent-alerts` / `TARGET_URL_CONFLUENT` from example rules and deploy manifests; Confluent and other producers use the same OCP webhook URL. Field Mapper **Confluent** preset merge checkbox removed; built-in `confluent-8.10` schema removed from `patterns.py` (flat JSON still works via Custom paste to `/webhook/ocp`). Docs and test scripts updated.

### Security

- **Dependencies (pip-audit 2026-04-19):** Pinned `urllib3>=2.6.3,<3`, `pytest>=9.0.3,<10`, `kubernetes>=35,<36` so a clean install reports **no known CVEs** in the resolved tree (addresses urllib3 redirect/decompression CVEs/GHSAs, pytest CVE-2025-71176; kubernetes 35+ allows urllib3 2.x). Documented in `SECURITY.md` and `VA_TEST.md`.

### Added

- **SBOM:** Committed CycloneDX 1.6 JSON (`sbom/cyclonedx.json`) from a resolved `pip freeze` after `requirements.txt` install; `sbom/README.md` and `scripts/generate-sbom.{sh,ps1}` to regenerate; project maintenance rule in `.cursor/rules/sbom-regeneration.mdc` (regenerate only when dependencies change).
- **Live / Failed — bundled alert names:** When Alertmanager sends multiple `alerts[]` in one webhook, the UI shows a short **Alert(s)** preview (`[i] name · …`) with a hover tooltip listing every `[i] name` line; API fields `alert_bundle_preview` / `alert_bundle_detail` on recent Live and Failed rows. **Failed Events** client search matches those fields. i18n `colAlertBundle` / `colAlertBundleHint`; cache-bust static assets. Computation is a single pass over `alerts[]` at ingest (same order of magnitude as existing summary/severity extraction). **Tests:** `extract_bundle_alert_names` / `format_alert_bundle_for_ui` in `tests/test_alert_extract.py`.
- **Portal header site label:** `/version` returns optional `site` from `ALERTBRIDGE_SITE` or infers `cwdc` / `tls2` from the Route hostname (`Host` or `X-Forwarded-Host` when `Host` is not `*.apps.*`). UI shows `v… · site:cwdc · ns:alertbridge`. Deployment env in `install-ocp-pull.yaml`; tests in `tests/test_version_site.py`.
- **`/api/recent-sent`:** Returns up to **15** successful forwards sorted by **`ts` descending** (true “latest” first). In-memory `RECENT_SENT` holds up to 50. UI badges the top row as “Latest”. Fixes the old `maxlen=1` case where only the **last** unroll shard survived vs Live Events (first alert summary).
- **Custom source JSON:** Multiple stacked sample rows (`+ Add JSON sample`, up to 8); **Use as source fields** merges parsed paths from every non-empty row into one Source field list (unique paths) for mapping dropdowns.
- **Pattern mapping fallbacks:** Optional `source_field_ids` array on each mapping row — ordered source paths; the engine uses the first **non-empty** value (skips `null` and blank strings), then falls back to the first path that exists. Builds `TransformConfig.coalesce_sources` for Alertmanager payloads where `alerts[0]` vs `commonLabels` / `groupLabels` differ.
- **Field Mapper UI:** Per target row, **Source columns 1…n** (horizontal): numbered badges, field `<select>`s (same merged list), **+** inserts a column after that slot, **−** removes a column (minimum one), up to 12 columns — first non-empty value left-to-right wins. **Custom** mode: checkboxes to merge **OCP Alertmanager** and/or **Confluent** preset fields into every dropdown. Save/Apply sends `source_field_ids` when multiple options are set; loading restores from pattern or route `coalesce_sources`.
- **Mapper safety / design:** In-page hint explains option order and merge behavior; **duplicate path in the same target row** blocks Save/Apply with row highlight; **Load pattern (Custom)** auto-enables OCP/Confluent merge when saved paths reference preset fields not present in the pasted custom list.

### Fixed

- **DLQ / Recent-sent Alert status when transform omits `alerts[]`:** Stored `alert_firing` for unrolled shards (and single-shard forwards) now falls back to **inbound** `alerts[i].status` when the transformed body no longer includes Alertmanager `alerts[0].status` (common with `output_template`). Previously the UI showed **—** in the DLQ **Alert status** column in that case.
- **GET `/api/dlq/recent`:** If a JSONL row has no `alert_firing` but `transformed` still contains `alerts[0].status`, the API fills `alert_firing` for the UI (helps some older rows).
- **Failed Events severity vs Live:** `RECENT_FAILED` now uses the same bundle-level severity as Live (`extract_alert_severity(payload)` first), instead of preferring the last failed shard’s transformed payload (which could stay `warning` while another alert in the bundle was `critical`).
- **Severity on bundled Alertmanager webhooks:** `extract_alert_severity()` now prefers the **worst** `alerts[].labels.severity` across the whole `alerts[]` list before `commonLabels` / `groupLabels`, so Live Events / payloads match DLQ when one shard is `critical` and the group label is only `warning`.
- **Field Mapper:** `tr is not a function` when adding source options — DOM row variables named `tr` shadowed the i18n helper `tr()`; renamed to `rowEl` in `mapperSetOptionRowCount`, `onMapperAddSrcOptClick`, and `setMappingsToForm`.
- **Field Mapper:** `+ Add source option` click handler is attached even when `/api/pattern-schemas` fails (e.g. Basic Auth not ready yet); previously the listener only ran after a successful schema fetch.
- **Favicon:** `/favicon.ico` and `<link rel="icon" href="/static/favicon.svg">` to stop 404 noise in the console.
- **DLQ table:** **HTTP** and **Unroll** headers/cells had been left in `index.html` and `renderDlqTable` after the earlier column removal — stripped again; detail row `colspan` aligned (`DLQ_TABLE_COLS` updated with layout changes).

### Changed

- **UI (Alertmanager):** **Alert status** column (firing / resolved / mixed) from `alerts[].status`; **Source** column removed from Live / Failed / DLQ tables to reduce width. **HTTP** and **Forwarded** headers clarified. All table times, recent payloads/sent, and daily “Updated” use **GMT+7** via `formatTimeGMT7()` in the browser; server event timestamps now emit full ISO with `+07:00` (milliseconds) for reliable parsing.
- **UI (traceability):** **Webhook ID** column (after Time) is aligned across Live, Failed, and DLQ; i18n subtitles explain one POST id vs DLQ shard rows. Cache-bust `app.js` / `i18n.js` so thead matches tbody (avoids shifted columns when an old bundle omitted the Alerts column). **DLQ** polls every **3s** when the panel is open after Basic Auth (keeps page + expanded row); manual Refresh still reloads from page 1.
- **Deploy `install-ocp-pull.yaml`:** Route now sets `spec.host` to the short CWDC-style URL `alertbridge-lite.apps.cwdc.esb-kafka-prod.intra.ais` (edit the `cwdc` segment for tls2 or other shards before apply).
- **Outbound target probes / logs:** `httpx` and `httpcore` loggers default to WARNING so health probes no longer print one INFO JSON line per HTTP request. **Target status cache** default TTL raised from 12s to **30s** (`ALERTBRIDGE_TARGET_STATUS_CACHE_SEC`) to reduce how often each forward URL is probed (GET + POST per active route per refresh).
- **POST `/api/patterns/apply` (form with mappings):** Requires an existing saved pattern — `pattern_name` must match a library row (Save first). Apply updates the route transform only; it no longer auto-creates or updates the pattern library on apply. Optional `pattern_id` must match that name.
- **DLQ table:** Removed **HTTP** and **Unroll** columns to simplify the grid; `http_status`, `unroll_index`, and `unroll_count` remain visible in the row **Detail** JSON.

## [2026-04-02]

### Added

- **Alert severity in UI and API paths:** `extract_alert_severity()` reads severity from Alertmanager-style payloads (`commonLabels`, `groupLabels`, `alerts[].labels`, top-level `labels`, or flat `severity`). Severity is attached to live events, failed events, recent payloads/sent, DLQ rows, and forwarding responses where applicable.
- **Severity column** in Live requests, Failed events, and DLQ tables; badges with color by level (critical / warning / info / low / default).
- **Tests:** `tests/test_alert_extract.py` for severity extraction; persistence tests for **one saved pattern per name** (same name overwrites same id) and **apply-from-form** not duplicating rows.

### Changed

- **Saved patterns:** Saving a pattern with an existing name **updates** that row instead of creating a duplicate (`find_pattern_id_by_name`, `save_pattern` behavior). UI tracks `editorPatternId` so Save/Apply reuse the active or loaded pattern id; `POST /api/patterns/apply` accepts optional `pattern_id` to update the correct row.
- **Field Mapper copy (EN/TH):** Clarified Save vs Apply, single row per pattern name, updated button labels and status strings (`mapperPatternSavedOk`, `mapperApplyStatusLine`, etc.).
- **Active pattern line:** Shows which route the active pattern applies to, with highlighted styling (`.mapper-active-pattern-highlight`).

### Fixed

- **DLQ Unroll tooltip:** Tooltip text now uses the **actual** unroll fraction (`{i}/{n}`) for that row instead of a fixed `1/2` example; separate hint for cells showing `—`.
