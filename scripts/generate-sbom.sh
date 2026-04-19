#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ ! -d .venv-sbom ]]; then
  python3 -m venv .venv-sbom
fi
# Runtime tree only (no SBOM tool in this env — avoids cyclonedx in the BOM)
./.venv-sbom/bin/python -m pip install -q --upgrade pip
./.venv-sbom/bin/python -m pip install -q -r requirements.txt
./.venv-sbom/bin/python -m pip freeze --all --local | python3 -m cyclonedx_py requirements - \
  -o sbom/cyclonedx.json --of JSON --output-reproducible --sv 1.6
echo "Wrote sbom/cyclonedx.json"
