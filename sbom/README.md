# SBOM (CycloneDX)

- **File:** `cyclonedx.json` — CycloneDX **1.6** JSON, built from **resolved** packages (`pip freeze` after `pip install -r requirements.txt` in a clean virtualenv). This matches what the Docker image installs (runtime + transitive dependencies).
- **Regenerate** after any change to `requirements.txt` (or when refreshing pinned versions for audits):

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
