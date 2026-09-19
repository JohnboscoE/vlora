import { useCallback, useEffect, useRef, useState } from 'react';

// Minimal typings for the Web Speech API (not in every TypeScript DOM lib)
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow it in your browser\'s site settings, then try again.',
  'service-not-allowed': 'Speech recognition isn\'t allowed in this browser.',
  'audio-capture': 'No microphone found.',
  network: 'Speech recognition needs an internet connection.',
  'no-speech': 'I didn\'t hear anything — tap the mic and try again.',
};

/**
 * Browser speech-to-text. Streams the transcript (interim + final) to `onText`
 * while listening; stops on tap or after a pause. Never submits anything itself.
 */
export function useSpeechToText(onText: (transcript: string, isFinal: boolean) => void) {
  const supported = getRecognitionCtor() != null;
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    setError(null);
    const rec = new Ctor();
    rec.lang = navigator.language || 'en-US';
    rec.continuous = false; // stop after a pause
    rec.interimResults = true;

    rec.onresult = (e) => {
      let finalText = '';
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]!;
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      onTextRef.current((finalText + interim).trim(), interim === '' && finalText !== '');
    };
    rec.onerror = (e) => {
      if (e.error !== 'aborted') setError(ERROR_MESSAGES[e.error] ?? 'Speech recognition stopped unexpectedly.');
    };
    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
      setError('Couldn\'t start the microphone.');
    }
  }, []);

  // Release the mic if the component unmounts mid-dictation
  useEffect(() => () => recognitionRef.current?.abort(), []);

  return { supported, listening, error, start, stop, clearError: () => setError(null) };
}
