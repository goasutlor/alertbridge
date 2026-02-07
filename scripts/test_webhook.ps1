# Test webhook with API Key authentication (PowerShell)
# Usage: .\scripts\test_webhook.ps1 [API_KEY]

param(
    [string]$ApiKey = "4727d4eea8f3396efc71487edc5e751820128d8e130da98b4b8e29a1f8f08bf3",
    [string]$BaseUrl = "http://127.0.0.1:8081"
)

Write-Host "Testing webhook with API Key..." -ForegroundColor Cyan
Write-Host "API Key: $($ApiKey.Substring(0, 16))..." -ForegroundColor Gray
Write-Host ""

# Test OCP/Prometheus Alertmanager format
Write-Host "=== Test 1: OCP Alert (firing) ===" -ForegroundColor Yellow
$ocpPayload = @{
    status = "firing"
    labels = @{
        severity = "critical"
        alertname = "HighCPU"
        instance = "node-1"
    }
    annotations = @{
        summary = "CPU above 90%"
        description = "Node node-1 CPU high"
    }
    startsAt = "2025-02-06T13:00:00Z"
    generatorURL = "http://prometheus/graph"
} | ConvertTo-Json -Depth 10

try {
    $response = Invoke-RestMethod -Uri "$BaseUrl/webhook/ocp" `
        -Method Post `
        -Headers @{
            "X-API-Key" = $ApiKey
            "Content-Type" = "application/json"
        } `
        -Body $ocpPayload
    Write-Host "✅ Success:" -ForegroundColor Green
    $response | ConvertTo-Json
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $reader.BaseStream.Position = 0
        $reader.DiscardBufferedData()
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response: $responseBody" -ForegroundColor Red
    }
}
Write-Host ""

# Test Confluent format
Write-Host "=== Test 2: Confluent Alert ===" -ForegroundColor Yellow
$confluentPayload = @{
    alertId = "a1"
    description = "Broker down"
    severity = "high"
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "$BaseUrl/webhook/confluent" `
        -Method Post `
        -Headers @{
            "X-API-Key" = $ApiKey
            "Content-Type" = "application/json"
        } `
        -Body $confluentPayload
    Write-Host "✅ Success:" -ForegroundColor Green
    $response | ConvertTo-Json
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $reader.BaseStream.Position = 0
        $reader.DiscardBufferedData()
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response: $responseBody" -ForegroundColor Red
    }
}
Write-Host ""

# Test without API Key (should fail if required)
Write-Host "=== Test 3: Without API Key (should fail if required) ===" -ForegroundColor Yellow
$testPayload = @{
    status = "firing"
    labels = @{
        alertname = "Test"
    }
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "$BaseUrl/webhook/ocp" `
        -Method Post `
        -Headers @{
            "Content-Type" = "application/json"
        } `
        -Body $testPayload
    Write-Host "✅ Success (API Key not required):" -ForegroundColor Green
    $response | ConvertTo-Json
} catch {
    Write-Host "❌ Expected Error (API Key required): $($_.Exception.Message)" -ForegroundColor Yellow
}
Write-Host ""

Write-Host "Done!" -ForegroundColor Cyan
