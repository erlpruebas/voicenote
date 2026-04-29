export interface ProviderModel {
  id: string;
  name: string;
}

export interface Provider {
  id: string;
  name: string;
  apiKey: string;
  enabled: boolean;
  models: ProviderModel[];
  selectedModel: string;
  transcribeUrl?: string;
}

export interface Recording {
  id: string;
  name: string;
  audioName?: string;
  project: string;
  timestamp: number;
  duration: number;
  fileSize: number;
  transcribed: boolean;
  transcriptionCostUsd?: number;
  transcriptionError?: string;
}

export type Tab = 'record' | 'history' | 'settings';
export type RecordingStatus = 'idle' | 'recording' | 'paused' | 'processing';
