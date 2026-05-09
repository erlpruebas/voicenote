$ErrorActionPreference = "Stop"

$port = if ($env:PORT) { $env:PORT } else { "8787" }
$ruleName = "VoiceNote Media Server $port"

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).
  IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  Write-Host "Ejecuta PowerShell como Administrador para abrir el firewall." -ForegroundColor Red
  exit 1
}

$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "La regla ya existe: $ruleName" -ForegroundColor Yellow
  exit 0
}

New-NetFirewallRule `
  -DisplayName $ruleName `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort $port `
  -Action Allow `
  -Profile Private | Out-Null

Write-Host "Firewall abierto para TCP $port en redes privadas." -ForegroundColor Green
