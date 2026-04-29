import { blobToBase64 } from './base64';

const INLINE_MAX_BYTES = 18 * 1024 * 1024;

async function uploadFile(blob: Blob, apiKey: string): Promise<string> {
  const initRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(blob.size),
        'X-Goog-Upload-Header-Content-Type': 'audio/mpeg',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: 'voicenote-audio.mp3' } }),
    }
  );
  if (!initRes.ok) throw new Error(`Gemini upload init ${initRes.status}: ${await initRes.text()}`);

  const uploadUrl = initRes.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) throw new Error('No se recibio URL de subida de Gemini.');

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
      'Content-Type': 'audio/mpeg',
    },
    body: blob,
  });
  if (!uploadRes.ok) throw new Error(`Gemini upload ${uploadRes.status}: ${await uploadRes.text()}`);

  const data = await uploadRes.json();
  const uri: string | undefined = data.file?.uri;
  if (!uri) throw new Error('No se recibio URI del archivo subido a Gemini.');

  await waitForActive(uri, apiKey);
  return uri;
}

async function waitForActive(fileUri: string, apiKey: string, maxWaitMs = 60_000) {
  const name = fileUri.split('/').pop();
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/files/${name}?key=${apiKey}`
    );
    const d = await r.json();
    if (d.state === 'ACTIVE') return;
    if (d.state === 'FAILED') throw new Error('Gemini file processing failed.');
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error('Tiempo de espera agotado esperando que Gemini procese el archivo.');
}

export async function transcribeGemini(
  blob: Blob,
  apiKey: string,
  model: string,
  prompt: string
): Promise<string> {
  let audioPart: object;

  if (blob.size <= INLINE_MAX_BYTES) {
    const b64 = await blobToBase64(blob);
    audioPart = { inlineData: { mimeType: 'audio/mpeg', data: b64 } };
  } else {
    const fileUri = await uploadFile(blob, apiKey);
    audioPart = { fileData: { mimeType: 'audio/mpeg', fileUri } };
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [audioPart, { text: prompt }] }],
        generationConfig: { temperature: 0 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini generateContent ${res.status}: ${await res.text()}`);

  const d = await res.json();
  return d.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}
