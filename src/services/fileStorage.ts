const DB_NAME = 'voicenote-fs';
const STORE_NAME = 'handles';

// ── IndexedDB helpers ──────────────────────────────────────────────────────

async function openDB(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function putHandle(key: string, handle: FileSystemHandle) {
  const db = await openDB();
  return new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(handle, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

async function getHandle(key: string): Promise<FileSystemHandle | null> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => res(req.result ?? null);
    req.onerror = () => rej(req.error);
  });
}

// ── Root directory ─────────────────────────────────────────────────────────

let _root: FileSystemDirectoryHandle | null = null;

export async function getRootDir(): Promise<FileSystemDirectoryHandle | null> {
  if (_root) return _root;
  const h = (await getHandle('root')) as FileSystemDirectoryHandle | null;
  if (!h) return null;
  try {
    // requestPermission exists in Chrome but not in all TS lib versions
    const perm = await (h as any).requestPermission({ mode: 'readwrite' });
    if (perm === 'granted') { _root = h; return h; }
  } catch { /* denied */ }
  return null;
}

export async function pickRootDir(): Promise<string> {
  const h = await (window as any).showDirectoryPicker({ mode: 'readwrite', startIn: 'documents' });
  _root = h;
  await putHandle('root', h);
  return h.name;
}

// ── Project directory picker ───────────────────────────────────────────────

export async function pickProjectDir(): Promise<string> {
  const h = await (window as any).showDirectoryPicker({ mode: 'readwrite', startIn: 'documents' });
  return h.name;
}

// ── Keys file picker ───────────────────────────────────────────────────────

export async function pickKeysFile(): Promise<Record<string, string>> {
  const [fh] = await (window as any).showOpenFilePicker({
    types: [{ description: 'Archivo de claves', accept: { 'text/plain': ['.txt', '.env', ''] } }],
    startIn: 'downloads',
  });
  const file = await fh.getFile();
  return parseKeys(await file.text());
}

export function parseKeys(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim().replace(/^-\s*/, '').replace(/["']/g, '');
    const v = line.slice(eq + 1).trim().replace(/["']/g, '');
    if (k && v) out[k] = v;
  }
  return out;
}

// ── File helpers ───────────────────────────────────────────────────────────

async function projectDir(
  root: FileSystemDirectoryHandle,
  project: string
): Promise<FileSystemDirectoryHandle> {
  return root.getDirectoryHandle(project || 'Sin proyecto', { create: true });
}

async function uniqueName(dir: FileSystemDirectoryHandle, base: string, ext: string): Promise<string> {
  let name = `${base}${ext}`;
  try {
    await dir.getFileHandle(name);
    for (let i = 1; ; i++) {
      name = `${base}_${i}${ext}`;
      try { await dir.getFileHandle(name); }
      catch { break; }
    }
  } catch { /* original name free */ }
  return name;
}

async function writeFile(dir: FileSystemDirectoryHandle, name: string, data: Blob | string) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function saveAudio(
  blob: Blob,
  project: string,
  baseName: string
): Promise<string> {
  const root = await getRootDir();
  if (!root) {
    downloadBlob(blob, `${baseName}.mp3`);
    return `${baseName}.mp3`;
  }
  const dir = await projectDir(root, project);
  const name = await uniqueName(dir, baseName, '.mp3');
  await writeFile(dir, name, blob);
  return name;
}

export async function saveTranscript(
  text: string,
  project: string,
  audioName: string
): Promise<string> {
  const txtName = audioName.replace(/\.mp3$/i, '.txt');
  const root = await getRootDir();
  if (!root) {
    downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), txtName);
    return txtName;
  }
  const dir = await projectDir(root, project);
  await writeFile(dir, txtName, new Blob([text], { type: 'text/plain;charset=utf-8' }));
  return txtName;
}

export async function loadAudio(project: string, name: string): Promise<Blob | null> {
  const root = await getRootDir();
  if (!root) return null;
  try {
    const dir = await root.getDirectoryHandle(project || 'Sin proyecto');
    const fh = await dir.getFileHandle(name);
    return await fh.getFile();
  } catch { return null; }
}

export async function loadTranscript(project: string, audioName: string): Promise<string | null> {
  const root = await getRootDir();
  if (!root) return null;
  try {
    const dir = await root.getDirectoryHandle(project || 'Sin proyecto');
    const fh = await dir.getFileHandle(audioName.replace(/\.mp3$/i, '.txt'));
    const file = await fh.getFile();
    return await file.text();
  } catch { return null; }
}

export function isFileSystemSupported(): boolean {
  return typeof (window as any).showDirectoryPicker === 'function';
}

// ── Utilities ──────────────────────────────────────────────────────────────

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function generateTimestamp(): string {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const p2 = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${p2(m)}:${p2(s)}` : `${p2(m)}:${p2(s)}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
