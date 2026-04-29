export async function transcribeElevenLabs(
  blob: Blob, apiKey: string, model: string, _prompt: string
): Promise<string> {
  const fd = new FormData();
  fd.append('audio', blob, 'audio.mp3');
  fd.append('model_id', model);
  fd.append('language_code', 'es');

  const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: fd,
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.text ?? '';
}
