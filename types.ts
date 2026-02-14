
export enum AppStatus {
  IDLE = 'IDLE',
  LISTENING = 'LISTENING',
  PROCESSING = 'PROCESSING',
  SPEAKING = 'SPEAKING',
  ERROR = 'ERROR'
}

export interface TranscriptionResult {
  original: string;
  corrected: string;
  timestamp: number;
}

export enum VoiceGender {
  FEMALE = 'FEMALE',
  MALE = 'MALE'
}

export interface AppSettings {
  voiceGender: VoiceGender;
  volume: number;
  useGeminiCorrection: boolean;
}
