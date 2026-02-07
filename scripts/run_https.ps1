# Run alertbridge-lite with HTTPS (self-signed cert for local test).
# Usage: .\scripts\run_https.ps1
#        .\scripts\run_https.ps1 -Port 8443
#        .\scripts\run_https.ps1 -CertDir .\certs

param(
    [int] $Port = 8443,
    [string] $CertDir = "."
)

$keyFile = Join-Path $CertDir "key.pem"
$certFile = Join-Path $CertDir "cert.pem"

if (-not (Test-Path $keyFile) -or -not (Test-Path $certFile)) {
    Write-Host "Generating self-signed certificate (key.pem, cert.pem) in $CertDir ..."
    $null = New-Item -ItemType Directory -Force -Path $CertDir
    openssl req -x509 -newkey rsa:2048 -keyout $keyFile -out $certFile -days 365 -nodes -subj "/CN=localhost"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "openssl failed. Install OpenSSL or use Option A in README to create cert manually."
        exit 1
    }
    Write-Host "Done. Starting app with HTTPS."
}

$env:ALERTBRIDGE_RULES_PATH = if ($env:ALERTBRIDGE_RULES_PATH) { $env:ALERTBRIDGE_RULES_PATH } else { ".\rules.example.yaml" }
Write-Host "UI: https://127.0.0.1:$Port"
python -m uvicorn app.main:app --host 127.0.0.1 --port $Port --ssl-keyfile $keyFile --ssl-certfile $certFile
