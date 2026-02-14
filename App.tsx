import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AppStatus, TranscriptionResult, VoiceGender, AppSettings } from './types';
import { correctTranscription, synthesizeSpeech } from './services/geminiService';

// Helper para decodificar audio base64
const decodeBase64 = (base64: string) => {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [lastTranscription, setLastTranscription] = useState<TranscriptionResult | null>(null);
  const [settings, setSettings] = useState<AppSettings>({
    voiceGender: VoiceGender.MALE,
    volume: 1.0,
    useGeminiCorrection: true
  });
  
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const statusRef = useRef<AppStatus>(AppStatus.IDLE);
  const isProcessingRef = useRef<boolean>(false);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const initRecognition = useCallback(() => {
    if (!('webkitSpeechRecognition' in window)) {
      alert("Navegador no soportado.");
      return;
    }
    const recognition = new (window as any).webkitSpeechRecognition();
    recognition.lang = 'es-ES';
    recognition.continuous = true;
    recognition.interimResults = false;
    
    recognition.onstart = () => setStatus(AppStatus.LISTENING);
    
    recognition.onresult = (event: any) => {
      if (isProcessingRef.current || statusRef.current !== AppStatus.LISTENING) return;
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
      }
      if (finalTranscript.trim()) {
        isProcessingRef.current = true;
        processFinalText(finalTranscript.trim());
      }
    };

    recognition.onend = () => {
      if (statusRef.current === AppStatus.LISTENING && !isProcessingRef.current) {
        try { recognition.start(); } catch (e) {}
      }
    };
    recognitionRef.current = recognition;
  }, []);

  const processFinalText = async (text: string) => {
    if (recognitionRef.current) recognitionRef.current.abort();
    setStatus(AppStatus.PROCESSING);
    let processedText = text;
    if (settings.useGeminiCorrection) {
      processedText = await correctTranscription(text);
    }
    setLastTranscription({ original: text, corrected: processedText, timestamp: Date.now() });
    await speak(processedText);
  };

  const speak = async (text: string) => {
    setStatus(AppStatus.SPEAKING);
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      const ctx = audioContextRef.current;
      const isMale = settings.voiceGender === VoiceGender.MALE;
      const voiceName = isMale ? 'Puck' : 'Kore';
      const pitch = isMale ? -6.0 : 0;
      const rate = isMale ? 0.85 : 1.0;

      const base64Audio = await synthesizeSpeech(text, voiceName, pitch, rate);
      if (base64Audio) {
        const audioBuffer = await decodeAudioData(decodeBase64(base64Audio), ctx);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        const gainNode = ctx.createGain();
        gainNode.gain.value = settings.volume;
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
        source.onended = () => {
          setTimeout(() => {
            isProcessingRef.current = false;
            if (statusRef.current !== AppStatus.IDLE) {
              setStatus(AppStatus.LISTENING);
              try { recognitionRef.current?.start(); } catch (e) {}
            }
          }, 1000);
        };
        source.start(0);
      } else {
        isProcessingRef.current = false;
        setStatus(AppStatus.LISTENING);
      }
    } catch (e) {
      isProcessingRef.current = false;
      setStatus(AppStatus.IDLE);
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto bg-slate-900 text-white font-sans">
      <header className="p-6 border-b border-slate-800 flex justify-between items-center">
        <h1 className="text-xl font-bold text-blue-400">VozViva AI</h1>
        <button 
          onClick={() => setSettings(s => ({...s, voiceGender: s.voiceGender === VoiceGender.MALE ? VoiceGender.FEMALE : VoiceGender.MALE}))}
          className="p-2 rounded-full bg-slate-800"
        >
          {settings.voiceGender === VoiceGender.MALE ? '👴 Voz: Abuelo' : '👩 Voz: Mujer'}
        </button>
      </header>
      
      <main className="flex-1 p-6 flex flex-col justify-center">
        <div className={`w-32 h-32 rounded-full mx-auto mb-10 border-4 transition-all duration-500 ${
          status === AppStatus.LISTENING ? 'border-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.5)] scale-110' :
          status === AppStatus.SPEAKING ? 'border-green-500 shadow-[0_0_30px_rgba(34,197,94,0.5)]' :
          'border-slate-700'
        }`}>
          <div className="w-full h-full flex items-center justify-center">
            <i className={`fa-solid ${status === AppStatus.LISTENING ? 'fa-microphone' : 'fa-wave-square'} text-4xl`}></i>
          </div>
        </div>

        <div className="bg-slate-800/50 p-4 rounded-xl min-h-[150px]">
          {lastTranscription ? (
            <>
              <p className="text-slate-400 text-sm mb-2">Original: {lastTranscription.original}</p>
              <p className="text-xl font-medium">{lastTranscription.corrected}</p>
            </>
          ) : (
            <p className="text-slate-500 text-center mt-10">Pulsa el botón y empieza a susurrar</p>
          )}
        </div>
      </main>

      <footer className="p-6">
        <button
          onClick={() => {
            if (status === AppStatus.IDLE) {
              if (!recognitionRef.current) initRecognition();
              recognitionRef.current.start();
            } else {
              isProcessingRef.current = false;
              recognitionRef.current?.abort();
              setStatus(AppStatus.IDLE);
            }
          }}
          className={`w-full py-4 rounded-2xl font-bold text-lg ${
            status === AppStatus.IDLE ? 'bg-blue-600' : 'bg-rose-600'
          }`}
        >
          {status === AppStatus.IDLE ? 'COMENZAR' : 'DETENER'}
        </button>
      </footer>
    </div>
  );
};

export default App;
