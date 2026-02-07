# Run Alert Receiver on HTTPS (port 8443)
# Generates self-signed cert if missing (ต้องมี openssl — ติดตั้ง Git for Windows หรือ OpenSSL)
$CertPath = ".\certs"
$KeyFile = "$CertPath\key.pem"
$CertFile = "$CertPath\cert.pem"

if (-not (Test-Path $KeyFile) -or -not (Test-Path $CertFile)) {
    New-Item -ItemType Directory -Force -Path $CertPath | Out-Null
    Write-Host "Generating self-signed certificate..."
    $openssl = Get-Command openssl -ErrorAction SilentlyContinue
    if ($openssl) {
        openssl req -x509 -newkey rsa:2048 -keyout $KeyFile -out $CertFile -days 365 -nodes -subj "/CN=localhost"
    } else {
        python "$PSScriptRoot\gen_self_signed_cert.py"
    }
    if (-not (Test-Path $KeyFile) -or -not (Test-Path $CertFile)) {
        Write-Host "Error: Could not generate certificate." -ForegroundColor Red
        exit 1
    }
}

$env:ALARM_RECEIVER_RULES_PATH = if (Test-Path ".\config\patterns.yaml") { ".\config\patterns.yaml" } else { $null }
$Port = if ($args[0]) { $args[0] } else { 8443 }
Write-Host "Alert Receiver: https://localhost:$Port (self-signed cert)" -ForegroundColor Green
python -m uvicorn app.main:app --host 0.0.0.0 --port $Port --ssl-keyfile $KeyFile --ssl-certfile $CertFile
