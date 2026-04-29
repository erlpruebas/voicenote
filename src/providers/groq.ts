export async function transcribeGroq(
  blob: Blob, apiKey: string, model: string, prompt: string
): Promise<string> {
  const fd = new FormData();
  fd.append('file', blob, 'audio.mp3');
  fd.append('model', model);
  fd.append('prompt', prompt.slice(0, 224));
  fd.append('language', 'es');
  fd.append('response_format', 'text');

  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
  });
  if (!r.ok) throw new Error(`Groq ${r.status}: ${await r.text()}`);
  return r.text();
}
