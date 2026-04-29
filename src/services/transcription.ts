import { Provider } from '../types';
import { transcribeGroq } from '../providers/groq';
import { transcribeElevenLabs } from '../providers/elevenlabs';
import { transcribeGemini } from '../providers/gemini';
import { transcribeOpenRouter } from '../providers/openrouter';
import { transcribeDeepgram } from '../providers/deepgram';
import { transcribeAssemblyAI } from '../providers/assemblyai';

export async function transcribe(
  blob: Blob,
  provider: Provider,
  prompt: string
): Promise<string> {
  const { id, apiKey, selectedModel } = provider;
  if (!apiKey) throw new Error(`Sin API key para ${provider.name}`);

  switch (id) {
    case 'groq':       return transcribeGroq(blob, apiKey, selectedModel, prompt);
    case 'elevenlabs': return transcribeElevenLabs(blob, apiKey, selectedModel, prompt);
    case 'gemini':     return transcribeGemini(blob, apiKey, selectedModel, prompt);
    case 'openrouter': return transcribeOpenRouter(blob, apiKey, selectedModel, prompt);
    case 'deepgram':   return transcribeDeepgram(blob, apiKey, selectedModel, prompt);
    case 'assemblyai': return transcribeAssemblyAI(blob, apiKey, selectedModel, prompt);
    default:
      if (provider.transcribeUrl) {
        // Custom OpenAI-compatible endpoint
        const fd = new FormData();
        fd.append('file', blob, 'audio.mp3');
        fd.append('model', selectedModel);
        fd.append('prompt', prompt.slice(0, 224));
        fd.append('response_format', 'text');
        const r = await fetch(provider.transcribeUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: fd,
        });
        if (!r.ok) throw new Error(`${provider.name} ${r.status}: ${await r.text()}`);
        return r.text();
      }
      throw new Error(`Proveedor desconocido: ${id}`);
  }
}
