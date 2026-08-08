# Start all SmartStock AI services (PowerShell)
# Usage: .\bin\start-services.ps1

$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $root
Set-Location (Join-Path $root '..')

# Ensure logs directory
$logs = Join-Path (Get-Location) 'service-logs'
if (-not (Test-Path $logs)) { New-Item -ItemType Directory -Path $logs | Out-Null }

Write-Host 'Starting backend, frontend and ML services in background jobs...'
Start-Job -Name smartstock-backend -ScriptBlock { Set-Location (Join-Path $using:root '..'); npm run start --workspace backend > service-logs/backend.log 2>&1 } | Out-Null
Start-Job -Name smartstock-frontend -ScriptBlock { Set-Location (Join-Path $using:root '..'); npm run start:frontend > service-logs/frontend.log 2>&1 } | Out-Null
Start-Job -Name smartstock-ml -ScriptBlock { Set-Location (Join-Path $using:root '..'); npm run start:ml > service-logs/ml.log 2>&1 } | Out-Null

# Wait for backend health
Write-Host 'Waiting for backend health on http://localhost:4000/health...'
for ($i = 0; $i -lt 30; $i++) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:4000/health' -TimeoutSec 2
    if ($r.StatusCode -eq 200) { Write-Host 'Backend is ready.'; break }
  } catch { }
  Start-Sleep -Seconds 1
}

# Show job status and tail logs
Get-Job | Where-Object { $_.Name -like 'smartstock-*' } | Format-Table Id, Name, State -AutoSize

Write-Host 'Opening dashboard at http://localhost:3000'
Start-Process "http://localhost:3000"

Write-Host 'Logs are written to the service-logs directory.'
