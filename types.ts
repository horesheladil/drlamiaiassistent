
export type AssistantMode = 'idle' | 'listening' | 'speaking' | 'connecting' | 'error';

export interface TranscriptionEntry {
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}
