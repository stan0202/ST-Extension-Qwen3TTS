# Qwen3-TTS (KoboldCpp) — SillyTavern TTS Provider

Adds a **Qwen3-TTS** voice source to SillyTavern's TTS extension, backed by a
[KoboldCpp](https://github.com/LostRuins/koboldcpp) server running the
**Qwen3-TTS 1.7B CustomVoice** model.

## Why this extension?

SillyTavern's built-in **OpenAI Compatible** TTS provider already talks to
KoboldCpp's `/v1/audio/speech` endpoint and works for basic speech. The only
gap: ST's backend **drops two fields** that Qwen3-TTS actually uses —
`language` (language selection) and `instruction` (style / emotion control).
Those fields never reach KoboldCpp, so you can't pick a language or say
"whisper" / "用特别愤怒的语气说".

This provider talks to KoboldCpp **directly from the browser** (KoboldCpp sends
CORS headers), so all Qwen3-TTS fields survive. It registers a new **"Qwen3-TTS"**
entry in the TTS provider dropdown, alongside the built-in ones.

## Requirements

1. **SillyTavern** — latest `release` (or the version you run).
2. **KoboldCpp** with Qwen3-TTS running and reachable from where the ST
   **browser** runs (this extension calls KoboldCpp directly, not through the
   ST server).
3. The built-in **TTS** extension enabled (this adds a provider to it).

### KoboldCpp launch

```bash
koboldcpp \
  --ttsmodel /path/to/Qwen3-TTS-12Hz-1.7B-CustomVoice-Q8_0.gguf \
  --ttswavtokenizer /path/to/qwen3-tts-tokenizer-q8_0.gguf \
  --ttsgpu
```

Both GGUFs come from <https://huggingface.co/koboldcpp/tts>. Q8_0 is fine; use
F16 for max quality.

> **Network note:** the ST *browser* must be able to reach KoboldCpp. If you run
> ST on a NAS and KoboldCpp on another box, point the endpoint at the KoboldCpp
> machine's LAN IP (e.g. `http://192.168.0.99:5001/v1/audio/speech`). If you hit
> a browser "private network" prompt, accept it (KoboldCpp sets
> `Access-Control-Allow-Private-Network: true`).

## Install

In SillyTavern → **Manage Extensions** → **Install for all users** (or "Install
for me") and paste the Git URL:

```
https://github.com/stan0202/ST-Extension-Qwen3TTS
```

Then **restart / refresh** SillyTavern.

## Use

1. Open the **TTS** extension settings.
2. Set **TTS Source / Provider** to **Qwen3-TTS**.
3. Set the **Provider Endpoint** to your KoboldCpp `/v1/audio/speech` URL
   (default `http://127.0.0.1:5001/v1/audio/speech`).
4. (Optional) set **Language** and a **Style / Instruction** — applied to every
   line. Leave language **Auto** to let KoboldCpp default.
5. In the **Voice Map**, assign each character a Qwen3-TTS voice (Vivian, Ryan,
   etc.).
6. Hit a voice preview to test, or narrate a message.

### Voices (9 presets, CustomVoice)

| Speaker  | Character |
|----------|-----------|
| Vivian   | bright, slightly edgy young female (Chinese) |
| Serena   | warm, gentle young female (Chinese) |
| Uncle_Fu | seasoned male, low mellow timbre (Chinese) |
| Dylan    | youthful Beijing male (Chinese) |
| Eric     | lively Chengdu male, husky bright (Chinese) |
| Ryan     | dynamic male, strong rhythmic drive (English) |
| Aiden    | sunny American male (English) |
| Ono_Anna | playful Japanese female (Japanese) |
| Sohee    | warm Korean female, rich emotion (Korean) |

### Instruction / style

Qwen3-TTS takes a natural-language style instruction, e.g.
`用特别愤怒的语气说`, `whisper, very softly`, `speak like a movie narrator`.
Set it in the **Style / Instruction** field, or leave it blank and put a
`[style]` prefix in the message text — KoboldCpp extracts `[...]` from the
start of the text automatically when no `instruction` field is present.

### Languages

KoboldCpp understands: `en, zh, ja, ko, de, es, fr, ru, it, pt`. Pick one in
the **Language** dropdown, or **Auto** to let KoboldCpp decide.

## How it works

The provider's `generateTts` does a browser `fetch` to KoboldCpp:

```json
POST {endpoint}
{
  "input": "text to speak",
  "voice": "Vivian",
  "language": "zh",
  "instruction": "用特别愤怒的语气说",
  "response_format": "mp3",
  "model": "Qwen3-TTS"
}
```

(`speed`/`model` are accepted by KoboldCpp but ignored.) The audio blob is
returned to ST's TTS pipeline as usual.

## License

AGPL-3.0-or-later
