# Changelog

All notable changes to this project are documented in this file. The format is inspired by [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

<!-- Upcoming changes go here before release tagging. -->

### Added

- **Pattern mapping fallbacks:** Optional `source_field_ids` array on each mapping row — ordered source paths; the engine uses the first **non-empty** value (skips `null` and blank strings), then falls back to the first path that exists. Builds `TransformConfig.coalesce_sources` for Alertmanager payloads where `alerts[0]` vs `commonLabels` / `groupLabels` differ.
- **Field Mapper UI:** Per target row, a **fallback textarea** (one JSON path per line) under the source dropdown; Save/Apply sends `source_field_ids` when multiple paths are set. Loading a saved pattern or **active route transform** restores `source_field_ids` and `coalesce_sources` from config.

### Changed

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
