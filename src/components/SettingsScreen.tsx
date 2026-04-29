import { useEffect, useState } from 'react';
import {
  Key, ChevronDown, ChevronUp, Plus, Trash2, FolderOpen,
  FileKey, RotateCcw, CheckCircle2, Eye, EyeOff, Save,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { pickKeysFile, pickRootDir, isFileSystemSupported } from '../services/fileStorage';
import { Provider } from '../types';

export function SettingsScreen() {
  const {
    providers, updateProvider, addProvider, removeProvider,
    activeProvider, setActiveProvider,
    prompt, setPrompt, resetPrompt,
    rootFolderName, setRootFolderName,
    loadKeys,
  } = useStore();

  const [expanded, setExpanded] = useState<string | null>(activeProvider);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [newProvider, setNewProvider] = useState<Partial<Provider>>({});
  const [keysLoaded, setKeysLoaded] = useState(false);
  const [folderMsg, setFolderMsg] = useState('');
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});
  const [localPrompt, setLocalPrompt] = useState(prompt);
  const [promptSaved, setPromptSaved] = useState(false);

  useEffect(() => {
    setLocalPrompt(prompt);
  }, [prompt]);

  // ── Keys file ─────────────────────────────────────────────────────────────

  async function handleLoadKeys() {
    try {
      const keys = await pickKeysFile();
      loadKeys(keys);
      setKeysLoaded(true);
      setTimeout(() => setKeysLoaded(false), 4000);
    } catch { /* cancelled */ }
  }

  // ── Root folder ───────────────────────────────────────────────────────────

  async function handlePickFolder() {
    try {
      const name = await pickRootDir();
      setRootFolderName(name);
      setFolderMsg(`Carpeta vinculada: ${name}`);
      setTimeout(() => setFolderMsg(''), 4000);
    } catch { /* cancelled */ }
  }

  // ── Add provider ──────────────────────────────────────────────────────────

  function saveNewProvider() {
    if (!newProvider.name || !newProvider.transcribeUrl) return;
    const p: Provider = {
      id: `custom-${Date.now()}`,
      name: newProvider.name,
      apiKey: newProvider.apiKey ?? '',
      enabled: true,
      models: [{ id: newProvider.selectedModel ?? 'default', name: newProvider.selectedModel ?? 'Default' }],
      selectedModel: newProvider.selectedModel ?? 'default',
      transcribeUrl: newProvider.transcribeUrl,
    };
    addProvider(p);
    setNewProvider({});
    setShowAddProvider(false);
  }

  function handleSavePrompt() {
    setPrompt(localPrompt);
    setPromptSaved(true);
    setTimeout(() => setPromptSaved(false), 3000);
  }

  function handleResetPrompt() {
    resetPrompt();
    setPromptSaved(false);
  }

  return (
    <div className="screen flex flex-col gap-6 pb-6">
      <h2 className="text-xl font-bold text-gray-900 dark:text-white pt-2">Ajustes</h2>

      {/* ── Carpeta de almacenamiento ─────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <h3 className="section-title">Almacenamiento</h3>
        <div className="card flex flex-col gap-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Carpeta raíz donde se guardan los proyectos, audios y transcripciones.
          </p>
          {rootFolderName && (
            <div className="flex items-center gap-2 text-sm text-brand-600 dark:text-brand-400 font-medium">
              <CheckCircle2 size={14} />
              {rootFolderName}
            </div>
          )}
          {isFileSystemSupported() ? (
            <button className="btn-secondary self-start flex items-center gap-2" onClick={handlePickFolder}>
              <FolderOpen size={16} />
              {rootFolderName ? 'Cambiar carpeta' : 'Seleccionar carpeta'}
            </button>
          ) : (
            <p className="text-xs text-amber-600">
              Tu navegador no soporta selección de carpeta. Los archivos se descargarán.
            </p>
          )}
          {folderMsg && <p className="text-xs text-green-600 dark:text-green-400">{folderMsg}</p>}
        </div>
      </section>

      {/* ── Archivo de claves ─────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <h3 className="section-title">Archivo de claves</h3>
        <div className="card flex flex-col gap-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Carga un archivo <code>.txt</code> con claves en formato <code>CLAVE=valor</code>.
            Las claves se aplican automáticamente a los proveedores correspondientes.
          </p>
          <button className="btn-secondary self-start flex items-center gap-2" onClick={handleLoadKeys}>
            <FileKey size={16} />
            Buscar archivo de claves…
          </button>
          {keysLoaded && (
            <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
              <CheckCircle2 size={12} /> Claves cargadas correctamente
            </p>
          )}
        </div>
      </section>

      {/* ── Proveedores ───────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="section-title">Proveedores</h3>
          <span className="text-xs text-gray-400">Activo: <span className="font-medium text-brand-500">
            {providers.find(p => p.id === activeProvider)?.name}
          </span></span>
        </div>

        {providers.map((p) => (
          <div key={p.id} className="card flex flex-col gap-0">
            {/* Provider header */}
            <button
              className="flex items-center justify-between py-1 w-full"
              onClick={() => setExpanded(expanded === p.id ? null : p.id)}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`w-2.5 h-2.5 rounded-full ${p.apiKey ? 'bg-green-400' : 'bg-gray-300'}`}
                  title={p.apiKey ? 'Clave configurada' : 'Sin clave'}
                />
                <span className="font-medium text-gray-800 dark:text-gray-200 text-sm">{p.name}</span>
                {p.id === activeProvider && (
                  <span className="badge">Activo</span>
                )}
              </div>
              {expanded === p.id ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>

            {expanded === p.id && (
              <div className="flex flex-col gap-3 pt-3 border-t border-gray-100 dark:border-gray-800 mt-2">
                {/* API Key */}
                <div>
                  <label className="field-label flex items-center gap-1">
                    <Key size={11} /> API Key
                  </label>
                  <div className="flex gap-2">
                    <input
                      type={visibleKeys[p.id] ? 'text' : 'password'}
                      className="field flex-1 font-mono text-xs"
                      placeholder="sk-…"
                      value={p.apiKey}
                      onChange={(e) => updateProvider(p.id, { apiKey: e.target.value })}
                    />
                    <button
                      className="icon-btn"
                      onClick={() => setVisibleKeys((v) => ({ ...v, [p.id]: !v[p.id] }))}
                    >
                      {visibleKeys[p.id] ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                {/* Model */}
                <div>
                  <label className="field-label">Modelo</label>
                  <select
                    className="field"
                    value={p.selectedModel}
                    onChange={(e) => updateProvider(p.id, { selectedModel: e.target.value })}
                  >
                    {p.models.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>

                {p.transcribeUrl !== undefined && (
                  <div>
                    <label className="field-label">URL del endpoint</label>
                    <input
                      className="field text-xs"
                      placeholder="https://api.example.com/v1/audio/transcriptions"
                      value={p.transcribeUrl ?? ''}
                      onChange={(e) => updateProvider(p.id, { transcribeUrl: e.target.value })}
                    />
                  </div>
                )}

                <div className="flex gap-2 mt-1">
                  {p.id !== activeProvider && (
                    <button
                      className="btn-primary text-xs py-1.5 px-3"
                      onClick={() => setActiveProvider(p.id)}
                    >
                      Usar este proveedor
                    </button>
                  )}
                  {p.id.startsWith('custom-') && (
                    <button
                      className="btn-danger text-xs py-1.5 px-3 flex items-center gap-1"
                      onClick={() => removeProvider(p.id)}
                    >
                      <Trash2 size={12} /> Eliminar
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Add custom provider */}
        {!showAddProvider ? (
          <button
            className="btn-secondary flex items-center gap-2 self-start text-sm"
            onClick={() => setShowAddProvider(true)}
          >
            <Plus size={15} /> Añadir proveedor
          </button>
        ) : (
          <div className="card flex flex-col gap-3">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Nuevo proveedor (compatible OpenAI)</p>
            <div>
              <label className="field-label">Nombre</label>
              <input
                className="field"
                placeholder="Mi proveedor"
                value={newProvider.name ?? ''}
                onChange={(e) => setNewProvider((v) => ({ ...v, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="field-label">API Key</label>
              <input className="field" type="password" value={newProvider.apiKey ?? ''}
                onChange={(e) => setNewProvider((v) => ({ ...v, apiKey: e.target.value }))} />
            </div>
            <div>
              <label className="field-label">URL del endpoint de transcripción</label>
              <input className="field text-xs"
                placeholder="https://api.example.com/v1/audio/transcriptions"
                value={newProvider.transcribeUrl ?? ''}
                onChange={(e) => setNewProvider((v) => ({ ...v, transcribeUrl: e.target.value }))} />
            </div>
            <div>
              <label className="field-label">ID del modelo</label>
              <input className="field" value={newProvider.selectedModel ?? ''}
                onChange={(e) => setNewProvider((v) => ({ ...v, selectedModel: e.target.value }))} />
            </div>
            <div className="flex gap-2">
              <button className="btn-primary flex-1" onClick={saveNewProvider}>Guardar</button>
              <button className="btn-secondary flex-1" onClick={() => setShowAddProvider(false)}>Cancelar</button>
            </div>
          </div>
        )}
      </section>

      {/* ── Prompt ───────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="section-title">Prompt de transcripción</h3>
          <div className="flex items-center gap-2">
            <button
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
              onClick={handleResetPrompt}
            >
              <RotateCcw size={11} /> Restablecer
            </button>
            <button
              className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1"
              onClick={handleSavePrompt}
              disabled={localPrompt === prompt}
            >
              <Save size={12} /> Guardar
            </button>
          </div>
        </div>
        <div className="card">
          <textarea
            className="field resize-none text-sm leading-relaxed min-h-32"
            value={localPrompt}
            onChange={(e) => {
              setLocalPrompt(e.target.value);
              setPromptSaved(false);
            }}
          />
          {promptSaved && (
            <p className="text-xs text-green-600 dark:text-green-400 mt-2 flex items-center gap-1">
              <CheckCircle2 size={12} /> Prompt guardado
            </p>
          )}
          <p className="text-xs text-gray-400 mt-2">
            Este texto se envía junto al audio al modelo de lenguaje para guiar la transcripción.
          </p>
        </div>
      </section>
    </div>
  );
}
