
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AppStatus, TranscriptionResult, VoiceGender, AppSettings } from './types';
import { correctTranscription, synthesizeSpeech } from './services/geminiService';
import { AudioVisualizer } from './components/AudioVisualizer';

// Helper for decoding base64 audio
const decodeBase64 = (base64: string) => {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

// Custom audio data decoder for PCM returned by Gemini TTS
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
  
  // Audio handling refs
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Initialize Speech Recognition (Web Speech API as proxy for the architecture demonstration)
  // Note: For a real production Android app, we would use the native Google Cloud Speech SDK.
  const initRecognition = useCallback(() => {
    if (!('webkitSpeechRecognition' in window)) {
      alert("Su navegador no soporta reconocimiento de voz. Por favor use Chrome.");
      return;
    }

    const recognition = new (window as any).webkitSpeechRecognition();
    recognition.lang = 'es-ES';
    recognition.continuous = true;
    recognition.interimResults = true;
    
    recognition.onstart = () => {
      setStatus(AppStatus.LISTENING);
    };

    recognition.onresult = async (event: any) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }

      if (finalTranscript) {
        processFinalText(finalTranscript);
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Recognition error", event.error);
      if (event.error !== 'no-speech') {
        setStatus(AppStatus.IDLE);
      }
    };

    recognition.onend = () => {
      if (status === AppStatus.LISTENING) {
        recognition.start(); // Keep listening unless manually stopped
      }
    };

    recognitionRef.current = recognition;
  }, [status]);

  const processFinalText = async (text: string) => {
    setStatus(AppStatus.PROCESSING);
    
    let processedText = text;
    if (settings.useGeminiCorrection) {
      processedText = await correctTranscription(text);
    }

    setLastTranscription({
      original: text,
      corrected: processedText,
      timestamp: Date.now()
    });

    // Speak it
    await speak(processedText);
  };

  const speak = async (text: string) => {
    setStatus(AppStatus.SPEAKING);
    
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      
      const ctx = audioContextRef.current;
      const voiceName = settings.voiceGender === VoiceGender.FEMALE ? 'Kore' : 'Puck';
      const base64Audio = await synthesizeSpeech(text, voiceName);
      
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
          setStatus(AppStatus.LISTENING);
        };
        
        source.start(0);
      } else {
        setStatus(AppStatus.LISTENING);
      }
    } catch (error) {
      console.error("Speech error", error);
      setStatus(AppStatus.IDLE);
    }
  };

  const toggleListening = () => {
    if (status === AppStatus.IDLE) {
      if (!recognitionRef.current) initRecognition();
      recognitionRef.current.start();
    } else {
      if (recognitionRef.current) recognitionRef.current.stop();
      setStatus(AppStatus.IDLE);
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto bg-slate-50 shadow-xl overflow-hidden font-sans">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">VozViva</h1>
          <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold">Amplificador Inteligente</p>
        </div>
        <div className="flex gap-2">
            <button 
                onClick={() => setSettings(s => ({...s, voiceGender: s.voiceGender === VoiceGender.FEMALE ? VoiceGender.MALE : VoiceGender.FEMALE}))}
                className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-200 transition-colors"
                title="Cambiar Voz"
            >
                <i className={`fa-solid ${settings.voiceGender === VoiceGender.FEMALE ? 'fa-venus' : 'fa-mars'}`}></i>
            </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col p-6 overflow-hidden relative">
        <AudioVisualizer status={status} />

        {/* Status Indicator */}
        <div className="text-center mb-8">
          <span className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            status === AppStatus.LISTENING ? 'bg-blue-100 text-blue-700' :
            status === AppStatus.PROCESSING ? 'bg-amber-100 text-amber-700' :
            status === AppStatus.SPEAKING ? 'bg-green-100 text-green-700' :
            'bg-slate-200 text-slate-600'
          }`}>
            {status === AppStatus.LISTENING ? 'Escuchando susurros...' :
             status === AppStatus.PROCESSING ? 'Procesando con IA...' :
             status === AppStatus.SPEAKING ? 'Amplificando voz...' :
             'Listo para empezar'}
          </span>
        </div>

        {/* Transcript Area */}
        <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col overflow-y-auto">
          {lastTranscription ? (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="text-xs text-slate-400 mb-2 uppercase font-bold">Captura</div>
              <p className="text-lg text-slate-800 mb-6 italic leading-relaxed">
                "{lastTranscription.original}"
              </p>
              
              <div className="text-xs text-green-500 mb-2 uppercase font-bold flex items-center gap-1">
                <i className="fa-solid fa-sparkles"></i> Salida Optimizada
              </div>
              <p className="text-xl font-medium text-slate-900 leading-snug">
                {lastTranscription.corrected}
              </p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-center px-4">
              <i className="fa-solid fa-comment-dots text-4xl mb-4 opacity-20"></i>
              <p className="text-sm">Su voz transcrita aparecerá aquí para confirmación visual.</p>
            </div>
          )}
        </div>
      </main>

      {/* Footer / Controls */}
      <footer className="p-8 bg-white border-t flex justify-center items-center">
        <button
          onClick={toggleListening}
          className={`w-full py-5 rounded-3xl text-xl font-bold flex items-center justify-center gap-3 transition-all transform active:scale-95 shadow-lg ${
            status === AppStatus.LISTENING 
            ? 'bg-rose-500 text-white hover:bg-rose-600 shadow-rose-200' 
            : 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-200'
          }`}
        >
          {status === AppStatus.LISTENING ? (
            <><i className="fa-solid fa-pause"></i> PAUSAR</>
          ) : (
            <><i className="fa-solid fa-microphone"></i> EMPEZAR A ESCUCHAR</>
          )}
        </button>
      </footer>

      {/* Documentation Overlay (Hidden by default) */}
      <div className="hidden">
        <h2>Arquitectura Técnica</h2>
        <p>1. STT: Google Cloud Speech Streaming API optimizado para Whisper-like levels.</p>
        <p>2. Backend: Edge processing para AGC y ruido.</p>
        <p>3. AI: Gemini 3 Flash para corrección ortotipográfica manteniendo semántica.</p>
        <p>4. TTS: Google Neural2 API (es-ES-Neural2-F) con pitch neutro.</p>
      </div>
    </div>
  );
};

export default App;
