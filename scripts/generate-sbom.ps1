$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
if (-not (Test-Path .venv-sbom)) {
  python -m venv .venv-sbom
}
& .\.venv-sbom\Scripts\python -m pip install -q --upgrade pip
& .\.venv-sbom\Scripts\python -m pip install -q -r requirements.txt
$freeze = & .\.venv-sbom\Scripts\pip freeze --all --local
$freeze | python -m cyclonedx_py requirements - -o sbom/cyclonedx.json --of JSON --output-reproducible --sv 1.6
Write-Host "Wrote sbom/cyclonedx.json"
