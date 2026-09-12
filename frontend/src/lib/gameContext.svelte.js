import { getContext, setContext } from 'svelte';
import { env } from '$env/dynamic/public';

class GameState {
    publicApiUrl = env.PUBLIC_API_URL;
    audioManager = new AudioManager();

    currentScreen = $state('MENU');
    sessionId = $state('');
    hasNext = $state(false);

    currentBg = $state('');
    currentSpeaker = $state(null);
    currentText = $state('');

    currentChoices = $state([]);

    playerVariables = $state({});
    textSpeed = $state(7);

    errorData = $state({ status: 'None', message: 'None', details: 'None' });
    isAnimating = $state(false);
    isLoading = $state(false);
    pendingNextStep = $state(false);

    // Smooth loader state handling: tracking whether loading visibility should activate
    showLoadingUI = $state(false);
    loadingTimeoutId = null;

    isGameStarted = $state(false);
    dialogueQueue = $state([]);
    requestGeneration = 0;

    constructor() {
        if (typeof window !== 'undefined') {
            const savedSpeed = localStorage.getItem('dreamrun_text_speed');
            if (savedSpeed) {
                this.textSpeed = parseInt(savedSpeed, 10);
            }
            $effect.root(() => {
                $effect(() => {
                    localStorage.setItem('dreamrun_text_speed', this.textSpeed.toString());
                });
            });
        }
    }

    startLoadingState() {
        this.isLoading = true;
        this.showLoadingUI = false;
        if (this.loadingTimeoutId) clearTimeout(this.loadingTimeoutId);
        
        this.loadingTimeoutId = setTimeout(() => {
            if (this.isLoading) {
                this.showLoadingUI = true;
            }
        }, 2000);
    }

    stopLoadingState() {
        this.isLoading = false;
        this.showLoadingUI = false;
        if (this.loadingTimeoutId) {
            clearTimeout(this.loadingTimeoutId);
            this.loadingTimeoutId = null;
        }
    }

    getVariable(key, fallback = null) {
        return this.playerVariables[key] !== undefined ? this.playerVariables[key] : fallback;
    }

    showError(status, message, details) {
        this.errorData = { status, message, details };
        this.currentScreen = 'ERROR';
        this.stopLoadingState();
        this.pendingNextStep = false;
        this.isGameStarted = false;
        this.dialogueQueue = [];
        this.currentTextParts = [{ kind: 'text', value: '' }];
        this.currentChoices = [];
        this.sessionId = '';
    }

    async parseAndShowBackendError(response) {
        try {
            const errorJson = await response.json();
            if (errorJson.detail && typeof errorJson.detail === 'object') {
                this.showError(
                    errorJson.detail.status || response.status.toString(),
                    errorJson.detail.message || `Backend error: ${response.statusText}`,
                    errorJson.detail.details || 'None'
                );
            } else {
                this.showError(
                    response.status.toString(),
                    `Backend error: ${response.statusText}`,
                    errorJson.detail || JSON.stringify(errorJson)
                );
            }
        } catch {
            try {
                const fallbackText = await response.text();
                this.showError(
                    response.status.toString(),
                    `Backend error: ${response.statusText}`,
                    fallbackText || 'None'
                );
            } catch {
                this.showError(
                    response.status.toString(),
                    `Backend error: ${response.statusText}`,
                    'None'
                );
            }
        }
    }

    processBackground(bg) {
        if (!bg) return;

        if (bg.startsWith('MISSING:')) {
            this.currentBg = bg;
        } else if (bg.startsWith('/assets')) {
            this.currentBg = `${this.publicApiUrl}${bg}`;
        } else {
            this.currentBg = bg;
        }
    }

    processDialogue(dialogue) {
        if (!dialogue) return;

        if (dialogue.type === 'game_end') {
            this.handleGameEnd();
            return;
        }

        if (Array.isArray(dialogue.audio) && dialogue.audio.length > 0) {
            this.audioManager.processAudioCommands(dialogue.audio, this.publicApiUrl);
        }

        if (dialogue.type === 'choice') {
            if (dialogue.bg) this.processBackground(dialogue.bg);
            this.currentChoices = dialogue.options || [];
            this.pendingNextStep = false;
            this.isGameStarted = true;
            return;
        }

        if (dialogue.bg) {
            this.processBackground(dialogue.bg);
        }

        this.currentSpeaker = dialogue.name || null;
        this.currentText = dialogue.text || ''; // FIXED: Binds plain processed string text
        this.currentChoices = [];

        this.pendingNextStep = true;
        this.isGameStarted = true;
    }

    async processBlock(steps) {
        if (!Array.isArray(steps) || steps.length === 0) {
            this.handleGameEnd();
            return;
        }

        try {
            const audioTargets = [];
            for (const step of steps) {
                if (step && Array.isArray(step.audio)) {
                    for (const cmd of step.audio) {
                        if ((cmd.modifier === 'sound' || cmd.modifier === 'music') && cmd.path) {
                            if (!cmd.path.startsWith('MISSING:')) {
                                const url = cmd.path.startsWith('/assets') ? `${this.publicApiUrl}${cmd.path}` : cmd.path;
                                audioTargets.push(url);
                            }
                        }
                    }
                }
            }
            if (audioTargets.length > 0) {
                await this.audioManager.preloadAudioBuffers(audioTargets);
            }
        } catch (err) {
            console.warn('[DreamRun][preload] Non-blocking asset hydration fallback triggered:', err);
        }

        if (steps[0] && steps[0].type === 'choice') {
            this.processDialogue(steps[0]);
            this.dialogueQueue = [];
            return;
        }

        const filteredNodes = steps.filter(step => step && (step.type === 'dialogue' || step.type === 'choice'));
        if (filteredNodes.length === 0) {
            this.handleGameEnd();
            return;
        }

        this.dialogueQueue = filteredNodes.slice(1);
        this.processDialogue(filteredNodes[0]);
    }

    async selectChoice(choiceIndex) {
        if (this.isLoading) return;
        this.startLoadingState();

        const generation = this.requestGeneration;

        try {
            const response = await fetch(`${this.publicApiUrl}/api/game/choice`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-ID': this.sessionId
                },
                body: JSON.stringify({ choice_index: choiceIndex })
            });

            if (generation !== this.requestGeneration) return;

            if (!response.ok) {
                await this.parseAndShowBackendError(response);
                return;
            }

            const data = await response.json();
            if (data.variables) this.playerVariables = data.variables;

            this.currentChoices = [];
            await this.processBlock(data.steps);

        } catch (err) {
            if (generation !== this.requestGeneration) return;
            this.showError(
                'CHOICE_SUBMIT_ERROR',
                'Failed to transmit structural decision index mapping frames.',
                err?.message || String(err)
            );
        } finally {
            if (generation === this.requestGeneration) {
                this.stopLoadingState();
            }
        }
    }

    resetGameState() {
        this.audioManager.clearAll();
        this.sessionId = '';
        this.currentBg = '';
        this.currentSpeaker = null;
        this.currentTextParts = [{ kind: 'text', value: '' }];
        this.currentChoices = [];
        this.playerVariables = {};
        this.pendingNextStep = false;
        this.isGameStarted = false;
        this.dialogueQueue = [];
        this.hasNext = false;
        this.errorData = { status: 'None', message: 'None', details: 'None' };
    }

    handleGameEnd() {
        this.audioManager.clearAll();
        this.currentScreen = 'MENU';
        this.pendingNextStep = false;
        this.isGameStarted = false;
        this.currentBg = '';
        this.currentSpeaker = null;
        this.currentTextParts = [{ kind: 'text', value: '' }];
        this.dialogueQueue = [];
        this.currentChoices = [];
        this.sessionId = '';
        this.hasNext = false;
    }

    async nextStep() {
        if (!this.isGameStarted) return;
        if (this.currentChoices.length > 0) return;

        if (this.dialogueQueue.length > 0) {
            const nextNode = this.dialogueQueue.shift();
            this.processDialogue(nextNode);
            return;
        }

        if (this.isLoading) return;
        if (!this.sessionId) return;

        this.startLoadingState();
        this.pendingNextStep = false;

        const generation = this.requestGeneration;

        try {
            const response = await fetch(`${this.publicApiUrl}/api/game/next`, {
                method: 'POST',
                headers: { 'X-Session-ID': this.sessionId }
            });

            if (generation !== this.requestGeneration) return;

            if (!response.ok) {
                await this.parseAndShowBackendError(response);
                return;
            }

            const data = await response.json();
            if (data.variables) this.playerVariables = data.variables;

            await this.processBlock(data.steps);

        } catch (err) {
            if (generation !== this.requestGeneration) return;
            this.showError(
                'GAME_FETCH_ERROR',
                'Failed to advance sequence frames.',
                err?.message || String(err)
            );
        } finally {
            if (generation === this.requestGeneration) {
                this.stopLoadingState();
            }
        }
    }

    async handleClick() {
        if (this.currentChoices.length > 0) return;
        if (!this.pendingNextStep) return;
        if (this.isLoading) return;
        await this.nextStep();
    }

    async startGame() {
        if (!this.publicApiUrl) {
            this.showError('ENV_MISSING_ERROR', 'The .env setup configuration is missing.', '');
            return;
        }

        this.requestGeneration += 1;
        const generation = this.requestGeneration;

        this.resetGameState();
        this.startLoadingState();

        try {
            const response = await fetch(`${this.publicApiUrl}/api/game/start`, { method: 'POST' });
            if (generation !== this.requestGeneration) return;

            if (!response.ok) {
                await this.parseAndShowBackendError(response);
                return;
            }

            const data = await response.json();
            this.sessionId = data.session_id;
            this.playerVariables = data.variables || {};
            this.currentScreen = 'GAME';

            await this.processBlock(data.steps);

        } catch (err) {
            if (generation !== this.requestGeneration) return;
            this.showError('FETCH_ERROR', 'Backend connection error.', err?.message || String(err));
        } finally {
            if (generation === this.requestGeneration) {
                this.stopLoadingState();
            }
        }
    }
}


/**
 * Web Audio API based audio manager.
 *
 * Replaces the previous HTMLAudioElement approach to guarantee
 * sample-accurate gapless looping for background music.
 *
 * The public API (processAudioCommands / stopAudio / clearAll) is
 * preserved so GameState does not need to change.
 *
 * AudioContext starts in "suspended" state until a user gesture.
 * _ensureContext() resumes it on every command. In practice the
 * first command arrives after the player has clicked "Start",
 * which counts as a gesture.
 */
class AudioManager {
    constructor() {
        // Lazy-initialized on the first command that needs playback.
        this.audioContext = null;

        // id -> { source, gainNode, modifier, buffer }
        // `source` may be null if the track has finished (one-shot sound).
        this.activeAudioPool = new Map();

        // url -> AudioBuffer cache, so repeated music does not re-decode.
        this.bufferCache = new Map();

        // id -> url, to know what to replay on resume after a one-shot
        // sound has already ended.
        this.trackUrlById = new Map();
    }

    // ---------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------

    // Pre-loading pipeline: concurrently resolves, streams, and caches high-density binary arrays over unstable connections
    async preloadAudioBuffers(urls) {
        if (typeof window === 'undefined') return;
        await this._ensureContext();
        
        const tasks = urls.map(url => this._loadBuffer(url).catch(e => {
            console.error(`[DreamRun][preload] Aggregation failure on endpoint target: ${url}`, e);
        }));
        await Promise.all(tasks);
    }

    async processAudioCommands(commands, publicApiUrl) {
        if (!Array.isArray(commands) || commands.length === 0) {
            return;
        }

        // Resume the context on every batch: cheap, and protects
        // against the case where the browser suspended it between
        // user gestures.
        await this._ensureContext();

        for (const cmd of commands) {
            const { modifier, id } = cmd;

            if (modifier === 'sound' || modifier === 'music') {
                await this._startTrack(cmd, publicApiUrl);
            }
            else if (modifier === 'modify') {
                this._modifyTrack(cmd);
            }
            else if (modifier === 'pause') {
                this._pauseTrack(id);
            }
            else if (modifier === 'resume') {
                this._resumeTrack(id);
            }
            else if (modifier === 'stop') {
                this.stopAudio(id);
            }
        }
    }

    stopAudio(id) {
        const entry = this.activeAudioPool.get(id);
        if (!entry) return;

        try {
            if (entry.source) {
                // Disconnect first so a pending stop does not fire onended.
                entry.source.onended = null;
                entry.source.stop();
                entry.source.disconnect();
            }
            if (entry.gainNode) {
                entry.gainNode.disconnect();
            }
        } catch (e) {
            // Calling stop() twice throws; ignore.
        }

        this.activeAudioPool.delete(id);
        this.trackUrlById.delete(id);
    }

    clearAll() {
        const ids = Array.from(this.activeAudioPool.keys());
        for (const id of ids) {
            this.stopAudio(id);
        }
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    async _ensureContext() {
        if (typeof window === 'undefined') return;

        if (!this.audioContext) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) {
                console.warn('[DreamRun][audio] Web Audio API is not supported.');
                return;
            }
            this.audioContext = new Ctx();
        }

        if (this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
            } catch (e) {
                console.warn('[DreamRun][audio] Failed to resume AudioContext:', e);
            }
        }
    }

    async _loadBuffer(url) {
        if (this.bufferCache.has(url)) {
            return this.bufferCache.get(url);
        }

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} while fetching ${url}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

        this.bufferCache.set(url, audioBuffer);
        return audioBuffer;
    }

    async _startTrack(cmd, publicApiUrl) {
        const { modifier, id } = cmd;

        if (cmd.path && cmd.path.startsWith('MISSING:')) {
            console.warn(`[DreamRun][audio] Missing asset for id=${id}: ${cmd.path}`);
            return;
        }

        const srcUrl = cmd.path && cmd.path.startsWith('/assets')
            ? `${publicApiUrl}${cmd.path}`
            : cmd.path;

        this.stopAudio(id);

        let audioBuffer;
        try {
            audioBuffer = await this._loadBuffer(srcUrl);
        } catch (e) {
            console.error(`[DreamRun][audio] Failed to load id=${id} from ${srcUrl}:`, e);
            return;
        }

        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.loop = modifier === 'music';

        const gainNode = this.audioContext.createGain();

        // Volume: either a plain value or an animated ramp.
        this._applyParam(gainNode.gain, cmd.volume, 1.0);

        // Pitch: same treatment.
        this._applyParam(source.playbackRate, cmd.pitch, 1.0);

        source.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        if (modifier !== 'music') {
            source.onended = () => {
                const entry = this.activeAudioPool.get(id);
                if (entry && entry.source === source) {
                    try { source.disconnect(); } catch {}
                    try { gainNode.disconnect(); } catch {}
                    this.activeAudioPool.delete(id);
                    this.trackUrlById.delete(id);
                }
            };
        }

        try {
            source.start();
        } catch (e) {
            console.error(`[DreamRun][audio] Failed to start id=${id}:`, e);
            return;
        }

        this.activeAudioPool.set(id, {
            source,
            gainNode,
            modifier,
            buffer: audioBuffer,
            startedAt: this.audioContext.currentTime,
            lastPitch: this._resolveScalar(cmd.pitch, 1.0),
            lastVolume: this._resolveScalar(cmd.volume, 1.0),
        });
        this.trackUrlById.set(id, srcUrl);
    }

    _modifyTrack(cmd) {
        const { id } = cmd;
        const entry = this.activeAudioPool.get(id);
        if (!entry) return;

        const currentPhysicalPitch = entry.source ? entry.source.playbackRate.value : (entry.lastPitch ?? 1.0);
        const currentPhysicalVolume = entry.gainNode ? entry.gainNode.gain.value : (entry.lastVolume ?? 1.0);

        // For modify operations, if the server payload doesn't supply a 'from' boundary,
        // we explicitly inject our safely cached 'lastPitch' / 'lastVolume' state markers 
        // into the payload parameters before running the timeline scheduler.
        if (entry.source && cmd.pitch !== null && cmd.pitch !== undefined) {
            let pitchPayload = cmd.pitch;
            if (typeof pitchPayload === 'object' && pitchPayload.from === undefined) {
                pitchPayload = { ...pitchPayload, from: currentPhysicalPitch };
            }
            
            this._applyParam(entry.source.playbackRate, pitchPayload, currentPhysicalPitch);
            entry.lastPitch = this._resolveScalar(cmd.pitch, currentPhysicalPitch);
        }
        
        if (entry.gainNode && cmd.volume !== null && cmd.volume !== undefined) {
            let volumePayload = cmd.volume;
            if (typeof volumePayload === 'object' && volumePayload.from === undefined) {
                volumePayload = { ...volumePayload, from: currentPhysicalVolume };
            }
            
            this._applyParam(entry.gainNode.gain, volumePayload, currentPhysicalVolume);
            entry.lastVolume = this._resolveScalar(cmd.volume, currentPhysicalVolume);
        }
    }

    _resolveScalar(payload, fallback) {
        if (typeof payload === 'number' && Number.isFinite(payload)) return payload;
        if (payload && typeof payload === 'object') {
            if (typeof payload.value === 'number' && Number.isFinite(payload.value)) return payload.value;
            if (typeof payload.to === 'number' && Number.isFinite(payload.to)) return payload.to;
        }
        return fallback;
    }

    /**
     * Apply a numeric value or an animation descriptor to an AudioParam.
     *
     * Accepts three shapes:
     *     { value, duration_ms }              plain value
     *     { from, to, duration_ms }           ramp between two values
     *     <number>                            shorthand for plain value
     *
     * Guards against NaN / Infinity so a malformed server payload does
     * not throw inside setValueAtTime / linearRampToValueAtTime.
     */
    _applyParam(param, payload, fallback) {
        const safe = (x, fb) => (typeof x === 'number' && Number.isFinite(x)) ? x : fb;
        const now = this.audioContext.currentTime;

        if (payload === null || payload === undefined) {
            // Relative instant modification: clamps volume or pitch without transitions
            param.cancelScheduledValues(now);
            param.value = safe(fallback, 0);
            return;
        }

        if (typeof payload === 'number') {
            // Relative instant modification: clamps volume or pitch without transitions
            param.cancelScheduledValues(now);
            param.value = safe(payload, safe(fallback, 0));
            return;
        }

        if (typeof payload !== 'object') {
            // Relative instant modification: clamps volume or pitch without transitions
            param.cancelScheduledValues(now);
            param.value = safe(fallback, 0);
            return;
        }

        // Animation form: { from, to, duration_ms }
        if ('to' in payload) {
            
            // Trust the fallback value (passed from our cached lastVolume/lastPitch memory slot) 
            // if payload.from is explicitly missing, avoiding broken timeline jumps.
            const fromV = (payload.from !== undefined && payload.from !== null) 
                ? safe(payload.from, safe(fallback, 0)) 
                : safe(fallback, 0);
                
            const toV = safe(payload.to, fromV);
            const durS = safe(payload.duration_ms, 0) / 1000;

            param.cancelScheduledValues(now);
            // Anchor baseline parameter position firmly at the current timeline point
            param.setValueAtTime(fromV, now);
            
            if (durS > 0) {
                // Smoothly progress towards target destination using native Web Audio scheduling
                param.linearRampToValueAtTime(toV, now + durS);
            } else {
                param.value = toV;
            }
            return;
        }

        if ('value' in payload) {
            // Relative instant modification: clamps volume or pitch without transitions
            param.cancelScheduledValues(now);
            param.value = safe(payload.value, safe(fallback, 0));
            return;
        }

        // Relative instant modification: clamps volume or pitch without transitions
        param.cancelScheduledValues(now);
        param.value = safe(fallback, 0);
    }


    _pauseTrack(id) {
        const entry = this.activeAudioPool.get(id);
        if (!entry || !entry.source) return;

        entry.lastPitch = entry.source.playbackRate.value;
        if (entry.gainNode) {
            entry.lastVolume = entry.gainNode.gain.value;
        }

        // Web Audio does not expose pause/resume on a source node.
        // The standard approach: record the elapsed offset, stop the
        // source, and on resume create a new source that starts at
        // the saved offset. The buffer is cached, so this is cheap.
        const elapsed = this.audioContext.currentTime - (entry.startedAt ?? 0);
        entry.pausedAt = (entry.pausedAt ?? 0) + elapsed;
        entry.startedAt = null;

        try {
            entry.source.onended = null;
            entry.source.stop();
            entry.source.disconnect();
        } catch {}

        // Mark as paused but keep the entry so resume() can use its buffer.
        entry.source = null;
    }

    _resumeTrack(id) {
        const entry = this.activeAudioPool.get(id);
        if (!entry) return;
        if (entry.source) return; // already playing

        const source = this.audioContext.createBufferSource();
        source.buffer = entry.buffer;
        
        // Restore the exact speed/pitch coefficient that was active before the track was paused
        source.playbackRate.value = entry.lastPitch ?? 1.0;
        source.loop = entry.modifier === 'music';

        source.connect(entry.gainNode);

        // Re-apply the cached volume directly onto the gain node parameter to avoid audio spike artifacts
        entry.gainNode.gain.setValueAtTime(entry.lastVolume ?? 1.0, this.audioContext.currentTime);

        try {
            source.start(0, entry.pausedAt ?? 0);
        } catch (e) {
            console.error(`[DreamRun][audio] Failed to resume id=${id}:`, e);
            return;
        }

        entry.source = source;
        entry.startedAt = this.audioContext.currentTime - (entry.pausedAt ?? 0);
        entry.pausedAt = null;
    }
}


const GAME_CONTEXT_KEY = Symbol('GAME_CONTEXT');

export function initGameContext() {
    return setContext(GAME_CONTEXT_KEY, new GameState());
}

export function useGameContext() {
    return getContext(GAME_CONTEXT_KEY);
}