# VoiceNote Media Server

Servidor local para convertir audio o video a MP3 ligero antes de transcribir.

## Arranque

```powershell
cd server
npm install
npm start
```

Por defecto escucha en `http://0.0.0.0:8787`.

Desde el movil, en Ajustes de VoiceNote configura:

```text
http://IP_DEL_PC:8787
```

Ejemplo:

```text
http://192.168.1.50:8787
```

## Comprobacion

```powershell
Invoke-RestMethod http://localhost:8787/health
```

## Formato de salida

- MP3
- mono
- 16 kHz
- 32 kbps

Este formato esta pensado para voz y transcripcion, no para conservar calidad musical.
