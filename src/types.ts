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
  sessionName?: string;
  project: string;
  timestamp: number;
  duration: number;
  fileSize: number;
  transcribed: boolean;
  segmentCount?: number;
  transcriptionCostUsd?: number;
  transcriptionError?: string;
}

export type TranscriptSegmentStatus = 'pending' | 'transcribing' | 'done' | 'edited' | 'error';

export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  rawText: string;
  editedText: string;
  highlighted: boolean;
  note: string;
  status: TranscriptSegmentStatus;
  error?: string;
}

export interface VoiceNoteSession {
  version: 1;
  id: string;
  name: string;
  project: string;
  audioFile: string;
  createdAt: number;
  updatedAt: number;
  duration: number;
  segments: TranscriptSegment[];
}

export type Tab = 'record' | 'history' | 'settings';
export type RecordingStatus = 'idle' | 'recording' | 'paused' | 'processing';
