export async function transcribeDeepgram(
  blob: Blob, apiKey: string, model: string, _prompt: string
): Promise<string> {
  const r = await fetch(
    `https://api.deepgram.com/v1/listen?model=${model}&language=es&smart_format=true&punctuate=true`,
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'audio/mpeg',
      },
      body: blob,
    }
  );
  if (!r.ok) throw new Error(`Deepgram ${r.status}: ${await r.text()}`);
  const d = await r.json();
  return d.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
}
