import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Provider, Recording, Tab, RecordingStatus } from '../types';

const DEFAULT_PROMPT =
  'Transcribe literalmente todo el contenido de este audio sin resumir ni interpretar. ' +
  'Mantén nombres propios y cualquier detalle relevante. ' +
  'No añadas puntuación que no esté claramente indicada por el tono o pausas del hablante.';

const DEFAULT_PROVIDERS: Provider[] = [
  {
    id: 'groq',
    name: 'Groq',
    apiKey: '',
    enabled: true,
    models: [
      { id: 'whisper-large-v3-turbo', name: 'Whisper Large v3 Turbo (rápido)' },
      { id: 'whisper-large-v3', name: 'Whisper Large v3 (preciso)' },
    ],
    selectedModel: 'whisper-large-v3-turbo',
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    apiKey: '',
    enabled: true,
    models: [
      { id: 'scribe_v1', name: 'Scribe v1 (mejor precisión)' },
    ],
    selectedModel: 'scribe_v1',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    apiKey: '',
    enabled: true,
    models: [
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (recomendado)' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (máxima calidad)' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
      { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite (rápido)' },
    ],
    selectedModel: 'gemini-2.5-flash',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    apiKey: '',
    enabled: true,
    models: [
      { id: 'google/gemini-flash-1.5', name: 'Gemini Flash 1.5' },
      { id: 'openai/gpt-4o-audio-preview', name: 'GPT-4o Audio' },
      { id: 'anthropic/claude-3-5-sonnet', name: 'Claude 3.5 Sonnet' },
    ],
    selectedModel: 'google/gemini-flash-1.5',
  },
  {
    id: 'deepgram',
    name: 'Deepgram',
    apiKey: '',
    enabled: true,
    models: [
      { id: 'nova-3', name: 'Nova-3 (alta precisión)' },
      { id: 'nova-2', name: 'Nova-2' },
    ],
    selectedModel: 'nova-3',
  },
  {
    id: 'assemblyai',
    name: 'AssemblyAI',
    apiKey: '',
    enabled: true,
    models: [
      { id: 'best', name: 'Universal-2 (mejor)' },
      { id: 'nano', name: 'Nano (rápido)' },
    ],
    selectedModel: 'best',
  },
];

interface StoreState {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;

  providers: Provider[];
  activeProvider: string;
  prompt: string;
  autoStopMinutes: number;
  rootFolderName: string | null;

  recordingStatus: RecordingStatus;
  currentProject: string;
  currentName: string;
  elapsedSeconds: number;
  autoStopEnabled: boolean;

  recordings: Recording[];
  selectedRecording: Recording | null;

  setProviders: (p: Provider[]) => void;
  updateProvider: (id: string, updates: Partial<Provider>) => void;
  addProvider: (p: Provider) => void;
  removeProvider: (id: string) => void;
  setActiveProvider: (id: string) => void;
  setPrompt: (p: string) => void;
  setAutoStopMinutes: (m: number) => void;
  setRootFolderName: (name: string | null) => void;

  setRecordingStatus: (s: RecordingStatus) => void;
  setCurrentProject: (p: string) => void;
  setCurrentName: (n: string) => void;
  setElapsedSeconds: (s: number) => void;
  setAutoStopEnabled: (e: boolean) => void;

  addRecording: (r: Recording) => void;
  updateRecording: (id: string, updates: Partial<Recording>) => void;
  removeRecording: (id: string) => void;
  setSelectedRecording: (r: Recording | null) => void;

  loadKeys: (keys: Record<string, string>) => void;
  resetPrompt: () => void;
}

export const useStore = create<StoreState>()(
  persist(
    (set) => ({
      activeTab: 'record',
      setActiveTab: (tab) => set({ activeTab: tab }),

      providers: DEFAULT_PROVIDERS,
      activeProvider: 'gemini',
      prompt: DEFAULT_PROMPT,
      autoStopMinutes: 90,
      rootFolderName: null,

      recordingStatus: 'idle',
      currentProject: '',
      currentName: '',
      elapsedSeconds: 0,
      autoStopEnabled: false,

      recordings: [],
      selectedRecording: null,

      setProviders: (providers) => set({ providers }),
      updateProvider: (id, updates) =>
        set((s) => ({
          providers: s.providers.map((p) => (p.id === id ? { ...p, ...updates } : p)),
        })),
      addProvider: (p) => set((s) => ({ providers: [...s.providers, p] })),
      removeProvider: (id) =>
        set((s) => ({ providers: s.providers.filter((p) => p.id !== id) })),
      setActiveProvider: (id) => set({ activeProvider: id }),
      setPrompt: (prompt) => set({ prompt }),
      setAutoStopMinutes: (autoStopMinutes) => set({ autoStopMinutes }),
      setRootFolderName: (rootFolderName) => set({ rootFolderName }),

      setRecordingStatus: (recordingStatus) => set({ recordingStatus }),
      setCurrentProject: (currentProject) => set({ currentProject }),
      setCurrentName: (currentName) => set({ currentName }),
      setElapsedSeconds: (elapsedSeconds) => set({ elapsedSeconds }),
      setAutoStopEnabled: (autoStopEnabled) => set({ autoStopEnabled }),

      addRecording: (r) => set((s) => ({ recordings: [r, ...s.recordings] })),
      updateRecording: (id, updates) =>
        set((s) => ({
          recordings: s.recordings.map((r) => (r.id === id ? { ...r, ...updates } : r)),
        })),
      removeRecording: (id) =>
        set((s) => ({ recordings: s.recordings.filter((r) => r.id !== id) })),
      setSelectedRecording: (selectedRecording) => set({ selectedRecording }),

      loadKeys: (keys) =>
        set((s) => ({
          providers: s.providers.map((p) => {
            const map: Record<string, string[]> = {
              groq: ['GROQ_API_KEY'],
              elevenlabs: ['ELEVENLABS_API_KEY'],
              gemini: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
              openrouter: ['OPENROUTER_API_KEY'],
              deepgram: ['DEEPGRAM_API_KEY'],
              assemblyai: ['ASSEMBLYAI_API_KEY'],
            };
            const found = (map[p.id] || []).map((k) => keys[k]).find(Boolean);
            return found ? { ...p, apiKey: found } : p;
          }),
        })),

      resetPrompt: () => set({ prompt: DEFAULT_PROMPT }),
    }),
    {
      name: 'voicenote-v1',
      partialize: (s) => ({
        providers: s.providers,
        activeProvider: s.activeProvider,
        prompt: s.prompt,
        autoStopMinutes: s.autoStopMinutes,
        autoStopEnabled: s.autoStopEnabled,
        rootFolderName: s.rootFolderName,
        recordings: s.recordings,
      }),
    }
  )
);
