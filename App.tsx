import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AppStatus, TranscriptionResult, VoiceGender, AppSettings } from './types';
import { correctTranscription, synthesizeSpeech } from './services/geminiService';

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
    
    // CAMBIO CLAVE 1: continuous false hace que onresult salte MUCHO más rápido
    recognition.continuous = false; 
    recognition.interimResults = false;
    
    recognition.onstart = () => {
      setStatus(AppStatus.LISTENING);
      isProcessingRef.current = false;
    };
    
    recognition.onresult = (event: any) => {
      if (isProcessingRef.current) return;
      
      const finalTranscript = event.results[0][0].transcript;
      if (finalTranscript.trim()) {
        isProcessingRef.current = true;
        processFinalText(finalTranscript.trim());
      }
    };

    recognition.onend = () => {
      // Si el micro se apaga (porque continuous es false) y no estamos procesando nada, reiniciamos
      if (statusRef.current === AppStatus.LISTENING && !isProcessingRef.current) {
        try { recognition.start(); } catch (e) {}
      }
    };
    recognitionRef.current = recognition;
  }, []);

  const processFinalText = async (text: string) => {
    // Abortamos cualquier escucha residual
    if (recognitionRef.current) recognitionRef.current.abort();
    
    setStatus(AppStatus.PROCESSING);
    
    let processedText = text;
    // La corrección de Gemini tarda ~1-2 segundos
    if (settings.useGeminiCorrection) {
      try {
        processedText = await correctTranscription(text);
      } catch (e) {
        console.error("Error en corrección, usando original");
      }
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
      
      // Llamada al TTS (Suele tardar ~1.5 segundos)
      const base64Audio = await synthesizeSpeech(
        text, 
        isMale ? 'Puck' : 'Kore', 
        isMale ? -6.0 : 0, 
        isMale ? 0.85 : 1.0
      );

      if (base64Audio) {
        const audioBuffer = await decodeAudioData(decodeBase64(base64Audio), ctx);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        const gainNode = ctx.createGain();
        gainNode.gain.value = settings.volume;
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        source.onended = () => {
          // Espera de 1 segundo para evitar que se escuche a sí mismo
          setTimeout(() => {
            isProcessingRef.current = false;
            if (statusRef.current !== AppStatus.IDLE) {
              setStatus(AppStatus.LISTENING);
              try { recognitionRef.current?.start(); } catch (e) {}
            }
          }, 800);
        };
        source.start(0);
      } else {
        throw new Error("Sin audio");
      }
    } catch (e) {
      isProcessingRef.current = false;
      setStatus(AppStatus.LISTENING);
      try { recognitionRef.current?.start(); } catch (e) {}
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto bg-slate-900 text-white font-sans">
      <header className="p-6 border-b border-slate-800 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-blue-400">VozViva AI</h1>
          <p className="text-[10px] text-slate-500 uppercase tracking-widest">Modo Alta Velocidad</p>
        </div>
        <button 
          onClick={() => setSettings(s => ({...s, voiceGender: s.voiceGender === VoiceGender.MALE ? VoiceGender.FEMALE : VoiceGender.MALE}))}
          className="p-2 px-4 rounded-full bg-slate-800 text-sm border border-slate-700 active:bg-slate-700"
        >
          {settings.voiceGender === VoiceGender.MALE ? '👴 Abuelo' : '👩 Mujer'}
        </button>
      </header>
      
      <main className="flex-1 p-6 flex flex-col justify-center">
        <div className={`w-32 h-32 rounded-full mx-auto mb-10 border-4 transition-all duration-300 flex items-center justify-center ${
          status === AppStatus.LISTENING ? 'border-blue-500 shadow-[0_0_40px_rgba(59,130,246,0.4)]' :
          status === AppStatus.PROCESSING ? 'border-amber-500 animate-pulse' :
          status === AppStatus.SPEAKING ? 'border-green-500 shadow-[0_0_40px_rgba(34,197,94,0.4)]' :
          'border-slate-800'
        }`}>
            <i className={`fa-solid ${
                status === AppStatus.LISTENING ? 'fa-microphone text-blue-400' : 
                status === AppStatus.PROCESSING ? 'fa-spinner fa-spin text-amber-400' :
                'fa-wave-square text-green-400'
            } text-4xl`}></i>
        </div>

        <div className="bg-slate-800/40 border border-slate-800 p-5 rounded-2xl min-h-[160px] backdrop-blur-sm">
          {lastTranscription ? (
            <div className="animate-in fade-in duration-500">
              <p className="text-slate-500 text-[10px] uppercase font-bold mb-1">Entrada detectada</p>
              <p className="text-slate-300 italic mb-4 text-sm">"{lastTranscription.original}"</p>
              <p className="text-slate-500 text-[10px] uppercase font-bold mb-1">Voz Clarificada</p>
              <p className="text-lg font-semibold text-white leading-tight">{lastTranscription.corrected}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full opacity-30">
              <i className="fa-solid fa-comment-slash text-2xl mb-2"></i>
              <p className="text-xs">Sin actividad reciente</p>
            </div>
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
          className={`w-full py-5 rounded-3xl font-black text-xl transition-all active:scale-95 ${
            status === AppStatus.IDLE ? 'bg-blue-600 shadow-lg shadow-blue-900/20' : 'bg-rose-600'
          }`}
        >
          {status === AppStatus.IDLE ? 'ACTIVAR' : 'DETENER'}
        </button>
      </footer>
    </div>
  );
};

export default App;
