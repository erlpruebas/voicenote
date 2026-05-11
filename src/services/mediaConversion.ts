export function isMp3File(file: File): boolean {
  return isMp3Blob(file, file.name);
}

export function isMp3Blob(blob: Blob, fileName = ''): boolean {
  return /\.mp3$/i.test(fileName) || blob.type === 'audio/mpeg' || blob.type === 'audio/mp3';
}

export function mediaBaseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/i, '') || 'audio';
}

export async function convertToLightMp3(file: File, serverUrl: string, serverToken: string): Promise<Blob> {
  return convertBlobToLightMp3(file, file.name, serverUrl, serverToken);
}

export async function convertBlobToLightMp3(
  blob: Blob,
  fileName: string,
  serverUrl: string,
  serverToken: string
): Promise<Blob> {
  const baseUrl = serverUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Configura el servidor de conversion en Ajustes.');

  const form = new FormData();
  form.append('file', blob, fileName);
  const headers: HeadersInit = {};
  if (serverToken.trim()) {
    headers.Authorization = `Bearer ${serverToken.trim()}`;
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/convert`, {
      method: 'POST',
      headers,
      body: form,
    });
  } catch (error) {
    const isHttpsApp = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(baseUrl);
    const isPlainHttp = /^http:\/\//i.test(baseUrl);
    const hints = [
      'No se pudo conectar con el servidor multimedia.',
      isLocalhost ? 'En un movil, localhost apunta al movil, no al ordenador.' : '',
      isHttpsApp && isPlainHttp ? 'La app esta en HTTPS y el navegador bloquea servidores HTTP; usa una URL HTTPS de tunel.' : '',
      'Comprueba que el servidor este abierto y que la URL de Ajustes sea correcta.',
    ].filter(Boolean).join(' ');
    throw new Error(`${hints} Detalle: ${(error as Error).message}`);
  }

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(message || `Conversion fallida (${response.status})`);
  }

  return response.blob();
}
