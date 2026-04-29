export async function transcribeAssemblyAI(
  blob: Blob, apiKey: string, model: string, _prompt: string
): Promise<string> {
  const headers = { Authorization: apiKey, 'Content-Type': 'application/json' };

  // 1. Upload
  const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/octet-stream' },
    body: blob,
  });
  if (!uploadRes.ok) throw new Error(`AssemblyAI upload ${uploadRes.status}`);
  const { upload_url } = await uploadRes.json();

  // 2. Submit
  const subRes = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      audio_url: upload_url,
      speech_model: model,
      language_code: 'es',
    }),
  });
  if (!subRes.ok) throw new Error(`AssemblyAI submit ${subRes.status}`);
  const { id } = await subRes.json();

  // 3. Poll
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, { headers });
    const result = await poll.json();
    if (result.status === 'completed') return result.text ?? '';
    if (result.status === 'error') throw new Error(`AssemblyAI: ${result.error}`);
  }
}
