const DEFAULT_LANGUAGE = "en-US";

const getWindow = () => (typeof window !== "undefined" ? window : null);

export const browserVoiceCapabilities = () => {
    const win = getWindow();
    if (!win) return { recognition: false, synthesis: false };

    return {
        recognition: Boolean(win.SpeechRecognition || win.webkitSpeechRecognition),
        synthesis: Boolean(win.speechSynthesis && win.SpeechSynthesisUtterance),
    };
};

export const speechRecognitionErrorMessage = (code) => {
    switch (code) {
        case "not-allowed":
        case "service-not-allowed":
            return "Microphone access was blocked. Allow microphone permission for AnimeVerse and try again.";
        case "audio-capture":
            return "No working microphone was detected.";
        case "network":
            return "Speech recognition could not reach the browser speech service.";
        case "no-speech":
            return "I didn't hear anything. Tap the microphone and try again.";
        case "aborted":
            return "";
        default:
            return "Voice recognition stopped unexpectedly. You can still type your message.";
    }
};

export const createSpeechRecognizer = ({
    language = DEFAULT_LANGUAGE,
    onStart,
    onInterim,
    onFinal,
    onEnd,
    onError,
} = {}) => {
    const win = getWindow();
    const Recognition = win?.SpeechRecognition || win?.webkitSpeechRecognition;
    if (!Recognition) return null;

    const recognition = new Recognition();
    recognition.lang = language;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => onStart?.();
    recognition.onend = () => onEnd?.();
    recognition.onerror = (event) => onError?.(event?.error || "unknown");
    recognition.onresult = (event) => {
        let interim = "";
        let finalText = "";

        for (let index = event.resultIndex || 0; index < event.results.length; index += 1) {
            const result = event.results[index];
            const transcript = result?.[0]?.transcript || "";
            if (result?.isFinal) finalText += transcript;
            else interim += transcript;
        }

        const cleanInterim = interim.trim();
        const cleanFinal = finalText.trim();
        if (cleanInterim) onInterim?.(cleanInterim);
        if (cleanFinal) onFinal?.(cleanFinal);
    };

    return recognition;
};

const cleanForSpeech = (text) =>
    String(text || "")
        .replace(/```[\s\S]*?```/g, " code snippet ")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/https?:\/\/\S+/g, "")
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/[>*_~]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 12000);

const chooseVoice = (voices, language) => {
    if (!Array.isArray(voices) || voices.length === 0) return null;
    const normalized = String(language || DEFAULT_LANGUAGE).toLowerCase();
    const base = normalized.split("-")[0];

    return (
        voices.find((voice) => voice.default && voice.lang?.toLowerCase() === normalized) ||
        voices.find((voice) => voice.lang?.toLowerCase() === normalized) ||
        voices.find((voice) => voice.default && voice.lang?.toLowerCase().startsWith(base)) ||
        voices.find((voice) => voice.lang?.toLowerCase().startsWith(base)) ||
        null
    );
};

export const stopSpeaking = () => {
    const win = getWindow();
    if (!win?.speechSynthesis) return;
    win.speechSynthesis.cancel();
};

export const speakText = (
    text,
    {
        language = DEFAULT_LANGUAGE,
        rate = 1,
        pitch = 1,
        volume = 1,
        onStart,
        onEnd,
        onError,
    } = {}
) => {
    const win = getWindow();
    if (!win?.speechSynthesis || !win?.SpeechSynthesisUtterance) return null;

    const speechText = cleanForSpeech(text);
    if (!speechText) return null;

    stopSpeaking();

    const utterance = new win.SpeechSynthesisUtterance(speechText);
    utterance.lang = language;
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.volume = volume;

    const selectedVoice = chooseVoice(win.speechSynthesis.getVoices?.() || [], language);
    if (selectedVoice) {
        utterance.voice = selectedVoice;
        utterance.lang = selectedVoice.lang || language;
    }

    utterance.onstart = () => onStart?.();
    utterance.onend = () => onEnd?.();
    utterance.onerror = (event) => onError?.(event?.error || "speech-error");

    win.speechSynthesis.speak(utterance);
    return utterance;
};
