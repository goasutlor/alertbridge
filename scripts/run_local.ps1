# Run alertbridge-lite locally for Look & Feel + load test.
# Uses rules.example.yaml. Forward will fail (202) unless you set TARGET_URL_OCP etc.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
Set-Location $root

$rulesPath = Join-Path $root "rules.example.yaml"
if (-not (Test-Path $rulesPath)) {
    Write-Error "rules.example.yaml not found at $rulesPath"
}
$env:ALERTBRIDGE_RULES_PATH = $rulesPath

Write-Host "Starting alertbridge-lite (rules: $rulesPath)"
Write-Host "UI: http://127.0.0.1:8080"
Write-Host "Load test (in another terminal): python scripts/load_test_webhook.py"
Write-Host ""
& python -m uvicorn app.main:app --host 127.0.0.1 --port 8080
