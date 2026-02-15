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

async function decodeAudioData(data: Uint8Array, ctx: AudioContext): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < dataInt16.length; i++) {
    channelData[i] = dataInt16[i] / 32768.0;
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

  // Sincronización crucial del estado
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const stopMicrophone = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null; // Evitamos disparos accidentales
        recognitionRef.current.abort();
      } catch (e) { console.log("Error al parar:", e); }
    }
  };

  const startMicrophone = () => {
    if (statusRef.current === AppStatus.IDLE) return;
    
    // Si ya existe, lo limpiamos antes de crear uno nuevo para evitar bloqueos
    stopMicrophone();
    initRecognition(); 
    
    try {
      recognitionRef.current.start();
    } catch (e) {
      console.log("Error al iniciar micro, reintentando...");
      setTimeout(() => recognitionRef.current?.start(), 300);
    }
  };

  const initRecognition = useCallback(() => {
    const recognition = new (window as any).webkitSpeechRecognition();
    recognition.lang = 'es-ES';
    recognition.continuous = false; // Cambiado a false para mayor estabilidad en ciclos
    recognition.interimResults = false;
    
    recognition.onstart = () => {
      setStatus(AppStatus.LISTENING);
      isProcessingRef.current = false;
    };

    recognition.onresult = (event: any) => {
      if (isProcessingRef.current) return;

      const text = event.results[0][0].transcript;
      if (text.trim()) {
        isProcessingRef.current = true;
        processFinalText(text.trim());
      }
    };

    recognition.onend = () => {
      // Si el micro se apaga solo y no estamos procesando nada, lo reiniciamos
      if (statusRef.current === AppStatus.LISTENING && !isProcessingRef.current) {
        startMicrophone();
      }
    };

    recognitionRef.current = recognition;
  }, []);

  const processFinalText = async (text: string) => {
    stopMicrophone(); // Apagamos micro mientras la IA "piensa"
    setStatus(AppStatus.PROCESSING);
    
    let processedText = text;
    try {
      if (settings.useGeminiCorrection) {
        processedText = await correctTranscription(text);
      }
    } catch (e) { console.error(e); }

    setLastTranscription({ original: text, corrected: processedText, timestamp: Date.now() });
    await speak(processedText);
  };

  const speak = async (text: string) => {
    setStatus(AppStatus.SPEAKING);
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      
      const isMale = settings.voiceGender === VoiceGender.MALE;
      const base64Audio = await synthesizeSpeech(
        text, 
        isMale ? 'Puck' : 'Kore', 
        isMale ? -6.0 : 0, 
        isMale ? 0.85 : 1.0
      );

      if (base64Audio) {
        const ctx = audioContextRef.current;
        const audioBuffer = await decodeAudioData(decodeBase64(base64Audio), ctx);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        
        const gainNode = ctx.createGain();
        gainNode.gain.value = settings.volume;
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        source.onended = () => {
          // CLAVE: Esperar a que el sonido se disipe antes de volver a escuchar
          setTimeout(() => {
            isProcessingRef.current = false;
            if (statusRef.current !== AppStatus.IDLE) {
              startMicrophone();
            }
          }, 800);
        };
        source.start(0);
      } else {
        throw new Error("No audio data");
      }
    } catch (e) {
      console.error(e);
      isProcessingRef.current = false;
      setStatus(AppStatus.LISTENING);
      startMicrophone();
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto bg-slate-900 text-white font-sans">
      <header className="p-6 border-b border-slate-800 flex justify-between items-center">
        <h1 className="text-xl font-bold text-blue-400">VozViva AI</h1>
        <button 
          onClick={() => setSettings(s => ({...s, voiceGender: s.voiceGender === VoiceGender.MALE ? VoiceGender.FEMALE : VoiceGender.MALE}))}
          className="px-4 py-2 rounded-full bg-slate-800 text-sm"
        >
          {settings.voiceGender === VoiceGender.MALE ? '👴 Abuelo (80)' : '👩 Mujer'}
        </button>
      </header>
      
      <main className="flex-1 p-6 flex flex-col items-center">
        <div className={`w-32 h-32 rounded-full mb-10 border-4 flex items-center justify-center transition-all duration-500 ${
          status === AppStatus.LISTENING ? 'border-blue-500 shadow-[0_0_40px_rgba(59,130,246,0.6)] animate-pulse' :
          status === AppStatus.SPEAKING ? 'border-green-500 shadow-[0_0_40px_rgba(34,197,94,0.6)]' :
          'border-slate-700'
        }`}>
          <i className={`fa-solid ${status === AppStatus.LISTENING ? 'fa-microphone' : 'fa-volume-high'} text-4xl`}></i>
        </div>

        <div className="w-full bg-slate-800/80 p-5 rounded-2xl min-h-[200px] border border-slate-700">
          {status === AppStatus.PROCESSING ? (
            <p className="text-blue-300 animate-pulse text-center mt-12">La IA está aclarando tu voz...</p>
          ) : lastTranscription ? (
            <div className="space-y-4">
              <div>
                <span className="text-[10px] text-slate-500 uppercase font-bold tracking-tighter">Susurro detectado</span>
                <p className="text-slate-300 italic">"{lastTranscription.original}"</p>
              </div>
              <div className="pt-2 border-t border-slate-700">
                <span className="text-[10px] text-green-500 uppercase font-bold tracking-tighter">Voz amplificada</span>
                <p className="text-xl font-semibold text-white">{lastTranscription.corrected}</p>
              </div>
            </div>
          ) : (
            <p className="text-slate-500 text-center mt-12">Pulsa el botón y habla.<br/>La IA te repetirá con fuerza.</p>
          )}
        </div>
      </main>

      <footer className="p-6">
        <button
          onClick={() => {
            if (status === AppStatus.IDLE) {
              startMicrophone();
            } else {
              setStatus(AppStatus.IDLE);
              stopMicrophone();
            }
          }}
          className={`w-full py-5 rounded-3xl font-black text-xl tracking-tight transition-all active:scale-95 ${
            status === AppStatus.IDLE ? 'bg-blue-600 shadow-blue-900/40' : 'bg-rose-600'
          } shadow-xl`}
        >
          {status === AppStatus.IDLE ? 'ACTIVAR AMPLIFICADOR' : 'DESACTIVAR'}
        </button>
      </footer>
    </div>
  );
};

export default App;
