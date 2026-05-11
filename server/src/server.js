import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

const PORT = Number(process.env.PORT || 8787);
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 2048);
const SERVER_TOKEN = process.env.VOICENOTE_SERVER_TOKEN || '';
const TMP_DIR = path.join(os.tmpdir(), 'voicenote-media');

fs.mkdirSync(TMP_DIR, { recursive: true });
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const upload = multer({
  dest: TMP_DIR,
  limits: {
    fileSize: MAX_FILE_MB * 1024 * 1024,
  },
});

const app = express();
app.use(cors());

app.use((req, res, next) => {
  if (!SERVER_TOKEN || req.path === '/' || req.path === '/health') {
    next();
    return;
  }

  const auth = req.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (token === SERVER_TOKEN) {
    next();
    return;
  }

  res.status(401).send('Token del servidor multimedia invalido o ausente.');
});

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>VoiceNote Media Server</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; margin: 32px; line-height: 1.5; color: #111827; }
      code { background: #f3f4f6; padding: 2px 6px; border-radius: 6px; }
      .ok { color: #047857; font-weight: 700; }
    </style>
  </head>
  <body>
    <h1>VoiceNote Media Server</h1>
    <p class="ok">Servidor activo.</p>
    <p>Este servidor convierte audio y video a MP3 ligero para VoiceNote.</p>
    <p>Comprobacion tecnica: <a href="/health"><code>/health</code></a></p>
    <p>La app usa <code>POST /convert</code>; abrir <code>/convert</code> directamente en el navegador no convierte archivos.</p>
  </body>
</html>`);
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'voicenote-media-server' });
});

app.get('/convert', (_req, res) => {
  res.status(405).send('Usa la app VoiceNote para enviar archivos con POST /convert.');
});


app.post('/convert', upload.single('file'), async (req, res) => {
  const input = req.file;
  if (!input) {
    res.status(400).send('No se recibio ningun archivo.');
    return;
  }

  const outputName = `${crypto.randomUUID()}.mp3`;
  const outputPath = path.join(TMP_DIR, outputName);

  try {
    await convertToMp3(input.path, outputPath);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${safeBaseName(input.originalname)}.mp3"`);
    const stream = fs.createReadStream(outputPath);
    stream.pipe(res);
    stream.on('close', () => cleanup(input.path, outputPath));
  } catch (error) {
    cleanup(input.path, outputPath);
    res.status(500).send(`Conversion fallida: ${error.message}`);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`VoiceNote media server listening on http://0.0.0.0:${PORT}`);
  console.log(`Max upload: ${MAX_FILE_MB} MB`);
  console.log(`Token required: ${SERVER_TOKEN ? 'yes' : 'no'}`);
});

function convertToMp3(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .audioBitrate('32k')
      .format('mp3')
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
}

function safeBaseName(fileName) {
  return path.basename(fileName, path.extname(fileName)).replace(/[^\w.-]+/g, '_') || 'audio';
}

function cleanup(...paths) {
  for (const filePath of paths) {
    fs.promises.unlink(filePath).catch(() => {});
  }
}
