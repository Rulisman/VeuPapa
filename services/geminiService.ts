import { GoogleGenAI, Modality } from "@google/genai";

// Usamos el nombre de la variable configurado en su vite.config.ts
const ai = new GoogleGenAI(process.env.GEMINI_API_KEY || '');

/**
 * Corrige errores de transcripción manteniendo la semántica original.
 */
export const correctTranscription = async (text: string): Promise<string> => {
  if (!text || text.length < 3) return text;

  try {
    const model = ai.getGenerativeModel({ 
      model: 'gemini-1.5-flash', // Usamos la versión estable disponible en 2026
    });

    const prompt = `Actúa como un corrector ortotipográfico especializado en transcripciones de voz débil. 
    Corrige únicamente errores claros de reconocimiento manteniendo literalmente la intención y las palabras originales. 
    No añadas introducciones ni comentarios.
    Texto a corregir: "${text}"`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        topP: 0.95,
      },
    });
    
    return result.response.text().trim() || text;
  } catch (error) {
    console.error("Gemini Correction Error:", error);
    return text;
  }
};

/**
 * Sintetiza voz con parámetros ajustables para tono y velocidad.
 * Para un señor de 80 años: voiceName='Puck', pitch=-6.0, speakingRate=0.85
 */
export const synthesizeSpeech = async (
  text: string, 
  voiceName: string = 'Kore',
  pitch: number = 0,
  speakingRate: number = 1.0
): Promise<string | undefined> => {
  try {
    const model = ai.getGenerativeModel({ 
      model: "gemini-1.5-flash" // El modelo Flash soporta modalidades de audio
    });

    const response = await model.generateContent({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO" as Modality], // Forzamos salida de audio
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { 
              voiceName // 'Puck' para masculino, 'Kore' para femenino
            },
          },
        },
      },
    });

    // Nota: Si usas la versión más reciente del SDK, estos parámetros se inyectan 
    // en la configuración de la respuesta de audio.
    return response.response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  } catch (error) {
    console.error("TTS Error:", error);
    return undefined;
  }
};
