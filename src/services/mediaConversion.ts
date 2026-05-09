export function isMp3File(file: File): boolean {
  return /\.mp3$/i.test(file.name) || file.type === 'audio/mpeg';
}

export function mediaBaseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/i, '') || 'audio';
}

export async function convertToLightMp3(file: File, serverUrl: string, serverToken: string): Promise<Blob> {
  const baseUrl = serverUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Configura el servidor de conversion en Ajustes.');

  const form = new FormData();
  form.append('file', file, file.name);
  const headers: HeadersInit = {};
  if (serverToken.trim()) {
    headers.Authorization = `Bearer ${serverToken.trim()}`;
  }

  const response = await fetch(`${baseUrl}/convert`, {
    method: 'POST',
    headers,
    body: form,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(message || `Conversion fallida (${response.status})`);
  }

  return response.blob();
}
