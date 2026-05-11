$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

$port = if ($env:PORT) { $env:PORT } else { "8787" }
$maxFileMb = if ($env:MAX_FILE_MB) { $env:MAX_FILE_MB } else { "2048" }
$tokenConfigured = -not [string]::IsNullOrWhiteSpace($env:VOICENOTE_SERVER_TOKEN)

if (-not (Get-Command node -ErrorAction SilentlyContinue) -and (Test-Path "C:\Program Files\nodejs\node.exe")) {
  $env:Path = "C:\Program Files\nodejs;$env:Path"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js no esta instalado." -ForegroundColor Red
  Write-Host "Instala Node.js LTS con:"
  Write-Host "  winget install OpenJS.NodeJS.LTS"
  exit 1
}

if (-not (Test-Path ".\node_modules")) {
  Write-Host "Instalando dependencias..."
  npm install
}

$ips = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object {
    $_.IPAddress -notlike "127.*" -and
    $_.IPAddress -notlike "169.254.*" -and
    $_.PrefixOrigin -ne "WellKnown"
  } |
  Select-Object -ExpandProperty IPAddress -Unique

Write-Host ""
Write-Host "VoiceNote Media Server" -ForegroundColor Cyan
Write-Host "Puerto: $port"
Write-Host "Tamano maximo por archivo: $maxFileMb MB"
Write-Host "Token requerido en /convert: $(if ($tokenConfigured) { 'si' } else { 'no' })"
Write-Host ""
Write-Host "Prueba local:"
Write-Host "  http://localhost:$port/health"
Write-Host ""
if ($ips) {
  Write-Host "URLs LAN posibles:"
  foreach ($ip in $ips) {
    Write-Host "  http://$ip`:$port"
  }
  Write-Host ""
}
Write-Host "Para usarlo desde la app publicada por HTTPS, usa un tunel HTTPS."
Write-Host "Ejemplo temporal con Cloudflare Tunnel:"
Write-Host "  cloudflared tunnel --url http://localhost:$port"
Write-Host ""

$env:PORT = $port
$env:MAX_FILE_MB = $maxFileMb
npm start
