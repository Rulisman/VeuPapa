import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AppStatus, TranscriptionResult, VoiceGender, AppSettings } from './types';
import { correctTranscription, synthesizeSpeech } from './services/geminiService';
import { AudioVisualizer } from './components/AudioVisualizer';

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
    voiceGender: VoiceGender.FEMALE,
    volume: 1.0,
    useGeminiCorrection: true
  });
  
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const statusRef = useRef<AppStatus>(AppStatus.IDLE);
  
  // SEGURO 1: Evita que se disparen múltiples procesos a la vez
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
    
    recognition.onstart = () => {
      setStatus(AppStatus.LISTENING);
      isProcessingRef.current = false;
    };

    recognition.onresult = async (event: any) => {
      // SEGURO 2: Si ya estamos procesando o hablando, ignoramos cualquier entrada del micro
      if (isProcessingRef.current || statusRef.current !== AppStatus.LISTENING) {
        return;
      }

      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }

      if (finalTranscript.trim()) {
        isProcessingRef.current = true; // Bloqueo inmediato
        processFinalText(finalTranscript.trim());
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error !== 'no-speech') {
        console.error("Error:", event.error);
        setStatus(AppStatus.IDLE);
        isProcessingRef.current = false;
      }
    };

    recognition.onend = () => {
      // Solo reinicia si el usuario no lo ha parado manualmente y no estamos hablando
      if (statusRef.current === AppStatus.LISTENING && !isProcessingRef.current) {
        try { recognition.start(); } catch (e) {}
      }
    };

    recognitionRef.current = recognition;
  }, []);

  const processFinalText = async (text: string) => {
    // SEGURO 3: Abortar el micrófono de forma agresiva
    if (recognitionRef.current) {
      recognitionRef.current.abort(); 
    }

    setStatus(AppStatus.PROCESSING);
    
    let processedText = text;
    if (settings.useGeminiCorrection) {
      try {
        processedText = await correctTranscription(text);
      } catch (err) {
        console.error(err);
      }
    }

    setLastTranscription({
      original: text,
      corrected: processedText,
      timestamp: Date.now()
    });

    await speak(processedText);
  };

  const speak = async (text: string) => {
  setStatus(AppStatus.SPEAKING);
  
  try {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    
    const ctx = audioContextRef.current;

    // --- CONFIGURACIÓN VOZ DE ANCIANO ---
    const isMale = settings.voiceGender === VoiceGender.MALE;
    const voiceName = isMale ? 'Puck' : 'Kore';
    
    // Si es hombre, bajamos el tono (-6.0) y la velocidad (0.85) para el efecto de 80 años
    const pitch = isMale ? -6.0 : 0; 
    const speakingRate = isMale ? 0.85 : 1.0;

    // Llamamos al servicio con los nuevos parámetros de personalización
    const base64Audio = await synthesizeSpeech(text, voiceName, pitch, speakingRate);
    
    if (base64Audio) {
      const audioBytes = decodeBase64(base64Audio);
      const audioBuffer = await decodeAudioData(audioBytes, ctx);
      
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      
      const gainNode = ctx.createGain();
      gainNode.gain.value = settings.volume;
      
      source.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      source.onended = () => {
        // --- SEGURO ANTI-BUCLE ---
        // Esperamos 1 segundo de silencio tras hablar antes de volver a escuchar
        setTimeout(() => {
          isProcessingRef.current = false; // Liberamos el bloqueo de procesamiento
          
          if (statusRef.current !== AppStatus.IDLE) {
            setStatus(AppStatus.LISTENING);
            try {
              recognitionRef.current?.start();
            } catch (e) {
              console.log("El micrófono ya estaba activo");
            }
          }
        }, 1000);
      };
      
      source.start(0);
    } else {
      isProcessingRef.current = false;
      setStatus(AppStatus.LISTENING);
      recognitionRef.current?.start();
    }
  } catch (error) {
    console.error("Speech error", error);
    isProcessingRef.current = false;
    setStatus(AppStatus.IDLE);
  }
};

  const toggleListening = () => {
    if (status === AppStatus.IDLE) {
      if (!recognitionRef.current) initRecognition();
      recognitionRef.current.start();
    } else {
      isProcessingRef.current = false;
      if (recognitionRef.current) recognitionRef.current.abort();
      setStatus(AppStatus.IDLE);
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto bg-slate-50 shadow-xl overflow-hidden font-sans">
      <header className="bg-white border-b px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">VozViva</h1>
          <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold">Amplificador Inteligente</p>
        </div>
        <button 
            onClick={() => setSettings(s => ({...s, voiceGender: s.voiceGender === VoiceGender.FEMALE ? VoiceGender.MALE : VoiceGender.FEMALE}))}
            className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600"
        >
            <i className={`fa-solid ${settings.voiceGender === VoiceGender.FEMALE ? 'fa-venus' : 'fa-mars'}`}></i>
        </button>
      </header>

      <main className="flex-1 flex flex-col p-6 overflow-hidden relative">
        <AudioVisualizer status={status} />
        <div className="text-center mb-8">
          <span className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            status === AppStatus.LISTENING ? 'bg-blue-100 text-blue-700' :
            status === AppStatus.PROCESSING ? 'bg-amber-100 text-amber-700' :
            status === AppStatus.SPEAKING ? 'bg-green-100 text-green-700' :
            'bg-slate-200 text-slate-600'
          }`}>
            {status === AppStatus.LISTENING ? 'Escuchando susurros...' :
             status === AppStatus.PROCESSING ? 'Clarificando...' :
             status === AppStatus.SPEAKING ? 'IA hablando...' : 'Listo'}
          </span>
        </div>

        <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-100 p-6 overflow-y-auto">
          {lastTranscription ? (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="text-xs text-slate-400 mb-2 uppercase font-bold">Entrada captada</div>
              <p className="text-lg text-slate-800 mb-6 italic">"{lastTranscription.original}"</p>
              <div className="text-xs text-green-500 mb-2 uppercase font-bold">Voz Clarificada</div>
              <p className="text-xl font-medium text-slate-900 leading-snug">{lastTranscription.corrected}</p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-center opacity-40">
              <i className="fa-solid fa-microphone-lines text-4xl mb-4"></i>
              <p className="text-sm">Hable y la IA repetirá sus palabras con claridad.</p>
            </div>
          )}
        </div>
      </main>

      <footer className="p-8 bg-white border-t">
        <button
          onClick={toggleListening}
          className={`w-full py-5 rounded-3xl text-xl font-bold flex items-center justify-center gap-3 transition-all ${
            status === AppStatus.LISTENING ? 'bg-rose-500 text-white' : 'bg-blue-600 text-white'
          }`}
        >
          {status === AppStatus.LISTENING ? 'DETENER' : 'EMPEZAR A ESCUCHAR'}
        </button>
      </footer>
    </div>
  );
};

export default App;
