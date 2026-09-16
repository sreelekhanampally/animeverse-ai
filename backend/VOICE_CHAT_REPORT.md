# AnimeVerse Assistant Voice Chat Patch

## What changed

Voice chat is implemented entirely in the frontend around the existing AnimeVerse Assistant. No Gemini, MiniLM, MongoDB, or Express chat logic was changed.

### Voice input

- Added a microphone button beside the chat composer.
- Uses the browser `SpeechRecognition` / `webkitSpeechRecognition` implementation when available.
- Shows live interim speech in the text box while listening.
- A final recognized utterance is automatically sent through the existing `aiService.chat()` flow.
- Voice-originated turns automatically enable spoken replies.
- Microphone permission, missing-device, no-speech, network, and unsupported-browser failures degrade to a clear message while typed chat remains usable.
- Starting microphone input stops any currently spoken assistant reply so the assistant does not feed its own voice back into recognition.

### Spoken assistant replies

- Uses the browser `speechSynthesis` / `SpeechSynthesisUtterance` APIs, so there is no additional paid API or backend route.
- Added a `Voice replies on/off` control.
- When voice mode is on, new assistant answers are read aloud automatically.
- Every non-starter assistant message has an independent `Listen` button for replay.
- The currently playing answer exposes `Stop`.
- Markdown/links are cleaned before text-to-speech so the device voice does not read formatting noise or URLs.
- Speech callbacks use a generation token so an old cancelled utterance cannot incorrectly clear the state of a newer utterance.

### Chat persistence integration

The existing user-scoped session persistence was preserved and extended with the voice-mode preference. Navigating to a recommended video and coming back still restores:

- messages,
- catalog source cards,
- draft text,
- scroll position,
- voice-reply preference.

Speech itself does not resume after navigation, which is intentional.

### Reliability protections

- Recognition is one utterance per microphone tap rather than always-on listening.
- Duplicate final recognition events are ignored so one spoken request cannot accidentally create two chat turns.
- Recognition and speech synthesis are stopped when the page unmounts or a new chat starts.
- The Send button is disabled while recognition is actively listening to avoid competing submissions.
- Voice support is feature-detected. Unsupported browsers keep the normal text chat fully functional.

## Files changed

- `frontend/src/pages/AiChatPage.jsx`
- `frontend/src/utils/chatSession.js`
- `frontend/src/utils/browserVoice.js` (new)

## Verification performed

- `browserVoice.js` passes `node --check`.
- `chatSession.js` passes `node --check`.
- `AiChatPage.jsx` successfully parses/transpiles as JSX using TypeScript's parser.
- Mock browser tests verified:
  - feature detection,
  - recognition start/final transcript handling,
  - speech synthesis playback,
  - markdown cleanup before TTS,
  - microphone-permission error mapping.
- Session-storage tests verified voice mode survives save/load and clears with the active chat session.
- One TTS markdown-cleaning defect was found during testing (`**Hello**` initially left trailing `**`) and fixed before packaging.

## Browser/runtime notes

- Best demo target: current Chrome or Edge.
- Microphone permission is required.
- Speech recognition generally requires a secure context (`https://`) in production; `localhost` works for development.
- Browser speech recognition may use the browser vendor's speech service and therefore may require network access.
- Speech synthesis uses installed/browser-provided device voices.

## Manual smoke test

1. Open AnimeVerse Assistant in Chrome/Edge.
2. Click the microphone and allow microphone access.
3. Say: `Recommend me a short sports anime.`
4. Confirm the transcript is sent automatically.
5. Confirm the Gemini answer is spoken automatically and appears normally as text.
6. Click `Stop`, then `Listen` on the same answer.
7. Say: `Find Gojo videos in AnimeVerse.`
8. Open one returned video, go Back, and confirm the chat remains restored.
9. Confirm `Voice replies on` is still selected.
10. Turn voice replies off and verify typed chat still works without automatic speech.
