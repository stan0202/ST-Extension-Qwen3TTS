// Qwen3-TTS (KoboldCpp) — SillyTavern TTS provider
// Adds a "Qwen3-TTS" voice source that talks to a KoboldCpp /v1/audio/speech
// endpoint running the Qwen3-TTS 1.7B CustomVoice model.
//
// Why this exists: the built-in "OpenAI Compatible" provider works against
// KoboldCpp for basic TTS, but its ST backend drops the `language` and
// `instruction` fields that Qwen3-TTS uses for language selection and
// style/emotion control. This provider talks to KoboldCpp directly (it sends
// CORS headers) so those fields survive.
//
// KoboldCpp /v1/audio/speech request fields that actually matter:
//   input         -> text to speak
//   voice         -> speaker name (Vivian, Ryan, ...)
//   language      -> en|zh|ja|ko|de|es|fr|ru|it|pt  ("" = let KoboldCpp default)
//   instruction   -> style/emotion, e.g. "用特别愤怒的语气说" ("" = auto / extract from [brackets])
//   response_format -> wav | mp3
//   (speed, model are ignored by KoboldCpp but accepted)

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

// Values understood by KoboldCpp's C++ set_language()
const LANGUAGES = [
    { value: '',     label: 'Auto (KoboldCpp default)' },
    { value: 'en',   label: 'English' },
    { value: 'zh',   label: 'Chinese' },
    { value: 'ja',   label: 'Japanese' },
    { value: 'ko',   label: 'Korean' },
    { value: 'de',   label: 'German' },
    { value: 'es',   label: 'Spanish' },
    { value: 'fr',   label: 'French' },
    { value: 'ru',   label: 'Russian' },
    { value: 'it',   label: 'Italian' },
    { value: 'pt',   label: 'Portuguese' },
];

class Qwen3TtsProvider {
    settings;
    voices = [];
    audioElement = document.createElement('audio');

    defaultSettings = {
        voiceMap: {},
        model: 'Qwen3-TTS',
        provider_endpoint: 'http://127.0.0.1:5001/v1/audio/speech',
        available_voices: QWEN_VOICES.slice(),
        language: '',
        instruction: '',
        response_format: 'mp3',
    };

    get settingsHtml() {
        const langOptions = LANGUAGES
            .map(l => `<option value="${l.value}">${l.label}</option>`)
            .join('');
        return `
        <label for="qwen3tts_endpoint">Provider Endpoint:</label>
        <div class="flex-container alignItemsCenter">
            <div class="flex1">
                <input id="qwen3tts_endpoint" type="text" class="text_pole" maxlength="500" value="${this.defaultSettings.provider_endpoint}"/>
            </div>
        </div>
        <div class="info">KoboldCpp /v1/audio/speech URL, e.g. <code>http://&lt;host&gt;:5001/v1/audio/speech</code>. No API key needed unless KoboldCpp was started with a password.</div>
        <label for="qwen3tts_model">Model:</label>
        <input id="qwen3tts_model" type="text" class="text_pole" maxlength="500" value="${this.defaultSettings.model}"/>
        <label for="qwen3tts_voices">Available Voices (comma separated):</label>
        <input id="qwen3tts_voices" type="text" class="text_pole" value="${this.defaultSettings.available_voices.join(', ')}"/>
        <label for="qwen3tts_language">Language:</label>
        <select id="qwen3tts_language" class="default">
            ${langOptions}
        </select>
        <label for="qwen3tts_instruction">Style / Instruction (optional):</label>
        <input id="qwen3tts_instruction" type="text" class="text_pole" maxlength="500" placeholder="e.g. 用特别愤怒的语气说  /  whisper, very softly  /  speak like a narrator"/>
        <div class="info">Applies to every line. Leave blank to auto-detect. KoboldCpp also reads a <code>[style]</code> prefix in the message text when this is blank.</div>
        <label for="qwen3tts_format">Audio Format:</label>
        <select id="qwen3tts_format" class="default">
            <option value="mp3">mp3</option>
            <option value="wav">wav</option>
        </select>`;
    }

    async loadSettings(settings) {
        // Only accept keys defined in defaultSettings
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

        $('#qwen3tts_language').val(this.settings.language);
        $('#qwen3tts_language').on('change', () => this.onSettingsChange());

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
        this.settings.language = String($('#qwen3tts_language').val());
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

    async previewTtsVoice(voiceId) {
        this.audioElement.pause();
        this.audioElement.currentTime = 0;
        const response = await this.fetchTtsGeneration('Neque porro quisquam est qui dolorem ipsum.', voiceId);
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
        const response = await this.fetchTtsGeneration(text, voiceId);
        return response;
    }

    async fetchTtsGeneration(inputText, voiceId) {
        console.info(`Qwen3-TTS: generating for voice_id ${voiceId}`);
        const body = {
            input: inputText,
            voice: voiceId,
            response_format: this.settings.response_format,
            model: this.settings.model,
            language: this.settings.language,
            instruction: this.settings.instruction,
        };
        const response = await fetch(this.settings.provider_endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
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
