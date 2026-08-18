// Qwen3-TTS (KoboldCpp) — SillyTavern TTS provider
//
// Routes through SillyTavern's own backend (/api/openai/custom/generate-voice),
// exactly like the built-in "OpenAI Compatible" provider. That keeps the call
// same-origin (ST backend does the server-side fetch to the endpoint), so it
// works even when ST is served over https and KoboldCpp is plain http — no
// Mixed Content block, no CORS needed.
//
// Trade-off vs. talking to KoboldCpp directly: the ST backend only forwards
//   input / voice / response_format / speed / model
// so `language` and `instruction` do NOT survive as separate JSON fields.
// Workarounds:
//   - language  -> let KoboldCpp auto-detect (Qwen3-TTS handles zh/en/ja/ko well)
//   - instruction -> prepend a "[style]" prefix to the text. KoboldCpp's
//     tts_extract_instruction() auto-splits a leading [bracket] into the
//     instruction, so the global "Style / Instruction" below is injected there.
//
// KoboldCpp /v1/audio/speech fields (for reference):
//   input          -> text (with optional [instruction] prefix)
//   voice          -> speaker name (Vivian, Ryan, ...)
//   language       -> en|zh|ja|ko|...   (auto if omitted)
//   instruction    -> style/emotion     (auto from [brackets] if omitted)
//   response_format-> wav | mp3
//   (speed, model are ignored by KoboldCpp but accepted)

import { getRequestHeaders } from '../../../../script.js';
import { registerTtsProvider, saveTtsProviderSettings } from '../../tts/index.js';

const QWEN_VOICES = [
    'Vivian',     // bright, slightly edgy young female   (Chinese)
    'Serena',     // warm, gentle young female            (Chinese)
    'Uncle_Fu',   // seasoned male, low mellow timbre     (Chinese)
    'Dylan',      // youthful Beijing male, clear         (Chinese)
    'Eric',       // lively Chengdu male, husky bright    (Chinese)
    'Ryan',       // dynamic male, strong rhythmic drive  (English)
    'Aiden',      // sunny American male, clear midrange  (English)
    'Ono_Anna',   // playful Japanese female, light       (Japanese)
    'Sohee',      // warm Korean female, rich emotion     (Korean)
];

class Qwen3TtsProvider {
    settings;
    voices = [];
    audioElement = document.createElement('audio');

    defaultSettings = {
        voiceMap: {},
        model: 'Qwen3-TTS',
        provider_endpoint: 'http://192.168.0.99:5001/v1/audio/speech',
        available_voices: QWEN_VOICES.slice(),
        instruction: '',
        response_format: 'mp3',
    };

    get settingsHtml() {
        return `
        <label for="qwen3tts_endpoint">Provider Endpoint:</label>
        <div class="flex-container alignItemsCenter">
            <div class="flex1">
                <input id="qwen3tts_endpoint" type="text" class="text_pole" maxlength="500" value="${this.defaultSettings.provider_endpoint}"/>
            </div>
        </div>
        <div class="info">KoboldCpp /v1/audio/speech URL. The ST backend fetches this server-side, so it works over https without CORS. No API key unless KoboldCpp was started with a password.</div>
        <label for="qwen3tts_model">Model:</label>
        <input id="qwen3tts_model" type="text" class="text_pole" maxlength="500" value="${this.defaultSettings.model}"/>
        <label for="qwen3tts_voices">Available Voices (comma separated):</label>
        <input id="qwen3tts_voices" type="text" class="text_pole" value="${this.defaultSettings.available_voices.join(', ')}"/>
        <label for="qwen3tts_instruction">Style / Instruction (optional):</label>
        <input id="qwen3tts_instruction" type="text" class="text_pole" maxlength="500" placeholder="e.g. 用特别愤怒的语气说  /  whisper, very softly  /  speak like a narrator"/>
        <div class="info">Injected as a <code>[style]</code> prefix on every line (KoboldCpp auto-extracts it). Leave blank for natural delivery. Language is auto-detected by KoboldCpp.</div>
        <label for="qwen3tts_format">Audio Format:</label>
        <select id="qwen3tts_format" class="default">
            <option value="mp3">mp3</option>
            <option value="wav">wav</option>
        </select>`;
    }

    async loadSettings(settings) {
        this.settings = this.defaultSettings;
        for (const key in settings) {
            if (key in this.settings) {
                this.settings[key] = settings[key];
            }
        }

        $('#qwen3tts_endpoint').val(this.settings.provider_endpoint);
        $('#qwen3tts_endpoint').on('input', () => this.onSettingsChange());

        $('#qwen3tts_model').val(this.settings.model);
        $('#qwen3tts_model').on('input', () => this.onSettingsChange());

        $('#qwen3tts_voices').val(this.settings.available_voices.join(', '));
        $('#qwen3tts_voices').on('input', () => this.onSettingsChange());

        $('#qwen3tts_instruction').val(this.settings.instruction);
        $('#qwen3tts_instruction').on('input', () => this.onSettingsChange());

        $('#qwen3tts_format').val(this.settings.response_format);
        $('#qwen3tts_format').on('change', () => this.onSettingsChange());

        await this.checkReady();
        console.debug('Qwen3-TTS (KoboldCpp): settings loaded');
    }

    onSettingsChange() {
        this.settings.provider_endpoint = String($('#qwen3tts_endpoint').val());
        this.settings.model = String($('#qwen3tts_model').val());
        this.settings.available_voices = String($('#qwen3tts_voices').val())
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
        this.settings.instruction = String($('#qwen3tts_instruction').val());
        this.settings.response_format = String($('#qwen3tts_format').val());
        saveTtsProviderSettings();
    }

    async checkReady() {
        this.voices = await this.fetchTtsVoiceObjects();
    }

    async getVoice(voiceName) {
        if (this.voices.length === 0) {
            this.voices = await this.fetchTtsVoiceObjects();
        }
        const match = this.voices.filter(v => v.name === voiceName)[0];
        if (!match) {
            throw `Qwen3-TTS voice "${voiceName}" not found. Check "Available Voices".`;
        }
        return match;
    }

    async fetchTtsVoiceObjects() {
        return this.settings.available_voices.map(v => ({
            name: v,
            voice_id: v,
            lang: 'en-US',
        }));
    }

    // Inject the global instruction as a [bracket] prefix, which KoboldCpp's
    // tts_extract_instruction() splits out into the instruction automatically.
    // Only prepend if the text doesn't already start with a [bracket].
    applyInstruction(text) {
        const instr = (this.settings.instruction || '').trim();
        if (!instr) {
            return text;
        }
        if (text.trimStart().startsWith('[')) {
            return text; // user already wrote their own [style]
        }
        return `[${instr}] ${text}`;
    }

    async previewTtsVoice(voiceId) {
        this.audioElement.pause();
        this.audioElement.currentTime = 0;
        const response = await this.fetchTtsGeneration(this.applyInstruction('Neque porro quisquam est qui dolorem ipsum.'), voiceId);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const audio = await response.blob();
        const url = URL.createObjectURL(audio);
        this.audioElement.src = url;
        this.audioElement.play();
        this.audioElement.onended = () => URL.revokeObjectURL(url);
    }

    async generateTts(text, voiceId) {
        return await this.fetchTtsGeneration(this.applyInstruction(text), voiceId);
    }

    async fetchTtsGeneration(inputText, voiceId) {
        console.info(`Qwen3-TTS: generating for voice_id ${voiceId}`);
        // Same backend route the built-in OpenAI-compatible provider uses.
        const response = await fetch('/api/openai/custom/generate-voice', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                provider_endpoint: this.settings.provider_endpoint,
                model: this.settings.model,
                input: inputText,
                voice: voiceId,
                response_format: this.settings.response_format,
                speed: 1,
            }),
        });
        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            toastr.error(`Qwen3-TTS HTTP ${response.status}${errText ? `: ${errText.slice(0, 200)}` : ''}`, 'TTS Generation Failed');
            throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`);
        }
        return response;
    }
}

// Register after the TTS extension's #tts_provider exists (TTS loads at order 10).
// Poll briefly in case of load-order edge cases.
(function registerWhenReady() {
    const tryRegister = (attempts) => {
        if (document.getElementById('tts_provider')) {
            registerTtsProvider('Qwen3-TTS', Qwen3TtsProvider);
        } else if (attempts > 0) {
            setTimeout(() => tryRegister(attempts - 1), 100);
        } else {
            console.warn('Qwen3-TTS: #tts_provider not found, registering anyway (TTS extension may not be enabled)');
            registerTtsProvider('Qwen3-TTS', Qwen3TtsProvider);
        }
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => tryRegister(50));
    } else {
        tryRegister(50);
    }
})();
