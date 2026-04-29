import { blobToBase64 } from './base64';

export async function transcribeOpenRouter(
  blob: Blob, apiKey: string, model: string, prompt: string
): Promise<string> {
  const b64 = await blobToBase64(blob);

  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'input_audio', input_audio: { data: b64, format: 'mp3' } },
        ],
      }],
    }),
  });
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${await r.text()}`);
  const d = await r.json();
  return d.choices?.[0]?.message?.content ?? '';
}
