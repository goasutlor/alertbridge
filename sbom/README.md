# SBOM (CycloneDX)

- **File:** `cyclonedx.json` — CycloneDX **1.6** JSON, built from **resolved** packages (`pip freeze` after `pip install -r requirements.txt` in a clean virtualenv). This matches what the Docker image installs (runtime + transitive dependencies). Component **names and versions** in the BOM come from that resolved tree.

## Project rule (maintenance)

| Situation | Action |
|-----------|--------|
| **Add / remove / upgrade / downgrade** a dependency in `requirements.txt`, or change version ranges so **resolved versions** change | **Regenerate** `cyclonedx.json` (same PR/commit as the dependency change) using the scripts below, then commit the new file. |
| **No** change to dependencies or resolved install | **Do not** regenerate; keep the existing SBOM. |

This policy is also recorded for Cursor as `.cursor/rules/sbom-regeneration.mdc`.

- **Regenerate** when the table above requires it:

```bash
# Unix / Git Bash
./scripts/generate-sbom.sh
```

```powershell
# Windows (PowerShell)
.\scripts\generate-sbom.ps1
```

Prerequisite: `cyclonedx-bom` available to the interpreter used in the script (`pip install cyclonedx-bom` in the same environment as `python`, or rely on the script’s venv + global `python -m cyclonedx_py` as documented in the scripts).

The generator records the CycloneDX tooling used under `metadata.tools` only; it is not part of the application dependency tree.
