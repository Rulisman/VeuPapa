
import { GoogleGenAI, Type, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const correctTranscription = async (text: string): Promise<string> => {
  if (!text || text.length < 3) return text;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Corrige únicamente errores claros de reconocimiento manteniendo literalmente la intención y las palabras originales. No añadas ni elimines información. Texto: "${text}"`,
      config: {
        temperature: 0.1,
        topP: 1,
      },
    });
    
    return response.text?.trim() || text;
  } catch (error) {
    console.error("Gemini Correction Error:", error);
    return text;
  }
};

export const synthesizeSpeech = async (text: string, voiceName: string = 'Kore'): Promise<string | undefined> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  } catch (error) {
    console.error("TTS Error:", error);
    return undefined;
  }
};
