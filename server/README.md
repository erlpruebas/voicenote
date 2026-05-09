# VoiceNote Media Server

Servidor para convertir cualquier fuente con audio (MP3, OGG, MP4, MOV, MKV, WAV, M4A, etc.) a un MP3 ligero antes de transcribir.

La app mantiene la usabilidad principal: grabar, parar, guardar audio y transcribir despues. Este servidor solo se usa cuando cargas un archivo externo que hay que normalizar.

## Copiar a otro ordenador

Copia la carpeta `server` completa al ordenador que va a estar siempre encendido.

En ese ordenador instala Node.js LTS:

```powershell
winget install OpenJS.NodeJS.LTS
```

Luego arranca:

```powershell
cd C:\ruta\voicenote\server
.\start-server.ps1
```

El script instala dependencias si faltan y muestra las URLs locales disponibles.

## Seguridad

Si el servidor sera accesible desde internet, usa token.

En PowerShell:

```powershell
$env:VOICENOTE_SERVER_TOKEN="pon-aqui-una-clave-larga"
.\start-server.ps1
```

En la app VoiceNote, ve a Ajustes -> Servidor multimedia:

```text
URL del servidor: https://tu-url-publica
Token de acceso: pon-aqui-una-clave-larga
```

`/health` queda abierto para comprobacion. `/convert` exige token si `VOICENOTE_SERVER_TOKEN` esta configurado.

## Acceso desde cualquier sitio

La app publicada esta en HTTPS. Por eso, para usar el servidor desde el movil fuera de casa, la URL del servidor tambien debe ser HTTPS.

Opcion recomendada para empezar: Cloudflare Tunnel.

```powershell
winget install Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:8787
```

Cloudflare mostrara una URL temporal `https://...trycloudflare.com`. Pon esa URL en Ajustes de VoiceNote.

Mas adelante puedes crear un tunnel fijo con dominio propio para no tener que cambiar la URL cada vez.

## Uso solo en red local

Si solo quieres probar dentro de tu WiFi:

1. Abre PowerShell como Administrador.
2. Ejecuta:

```powershell
.\open-firewall.ps1
```

3. En la app pon:

```text
http://IP_DEL_PC:8787
```

Importante: esto puede fallar desde la web publicada por HTTPS por bloqueo de contenido mixto. Para el movil y produccion, usa HTTPS con tunnel.

## Comprobacion

```powershell
Invoke-RestMethod http://localhost:8787/health
```

Debe responder:

```json
{"ok":true,"service":"voicenote-media-server"}
```

## Configuracion

Variables opcionales:

```powershell
$env:PORT="8787"
$env:MAX_FILE_MB="2048"
$env:VOICENOTE_SERVER_TOKEN="pon-aqui-una-clave-larga"
```

## Formato de salida

- MP3
- mono
- 16 kHz
- 32 kbps

Este formato esta pensado para voz y transcripcion, no para conservar calidad musical.
