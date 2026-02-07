# Run Alarm Receiver on HTTP (port 8082 - avoids conflict with alertbridge-lite on 8080)
$env:ALARM_RECEIVER_RULES_PATH = if (Test-Path ".\config\patterns.yaml") { ".\config\patterns.yaml" } else { $null }
Write-Host "Alarm Receiver: http://localhost:8082"
python -m uvicorn app.main:app --host 0.0.0.0 --port 8082
