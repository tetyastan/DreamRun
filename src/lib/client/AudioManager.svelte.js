/**
 * Web Audio API based audio manager.
 *
 * Guarantees sample-accurate gapless looping, precise fade automation,
 * and click-free state changes.
 *
 * Every audio command that arrives from the server is applied through
 * this manager. Commands are keyed by `id`: two commands with the same
 * `id` operate on the same track, even across separate requests.
 *
 * When a save is loaded, the server sends the client a journal of
 * every audio command that was issued during this playthrough. The
 * client replays them one by one through processAudioCommands, which
 * rebuilds the exact audible scene. There is no separate
 * serializeState / restoreState path: the journal is the state.
 */
export class AudioManager {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this._pendingMasterVolume = 1.0;
        this.tracks = new Map();
        this.bufferCache = new Map();
        this._pendingLoads = new Map();
        
        // Atomic synchronization lock to prevent parallel initialization race conditions
        this._contextPromise = null;
    }

    /**
     * Public initializer explicitly hooked to user interaction boundaries (e.g., clicking "Load" or "Start").
     * Enforces context hydration before downstream asynchronous data pipelines are invoked.
     */
    async initialize() {
        await this._ensureContext();
    }

    /**
     * Warms the buffer cache for a list of urls.
     */
    async preloadAudioBuffers(urls) {
        if (typeof window === 'undefined' || urls.length === 0) return;
        await this._ensureContext();
        const tasks = urls.map(url =>
            this._loadBuffer(url).catch(e => {
                console.error(`[DreamRun][preload] Failed: ${url}`, e);
            })
        );
        await Promise.all(tasks);
    }

    /**
     * Dispatches a batch of audio commands.
     *
     * The same entry point is used during live play and during
     * replay after a load. There is no distinction between the two
     * because the resulting state should be identical either way.
     */
    async processAudioCommands(commands) {
        if (!Array.isArray(commands) || commands.length === 0) return;
        await this._ensureContext();

        for (const cmd of commands) {
            const trackId = cmd.id !== undefined && cmd.id !== null
                ? cmd.id
                : `default_${cmd.modifier}`;
            const cleanCmd = { ...cmd, id: trackId };

            console.log('[DreamRun][audio][cmd]', cleanCmd.modifier, trackId,
                'ctx.state=', this.audioContext.state);

            if (cleanCmd.modifier === 'sound' || cleanCmd.modifier === 'music') {
                await this._startTrack(cleanCmd);
            } else if (cleanCmd.modifier === 'modify') {
                this._modifyTrack(cleanCmd);
            } else if (cleanCmd.modifier === 'pause') {
                this._pauseTrack(trackId);
            } else if (cleanCmd.modifier === 'resume') {
                this._resumeTrack(trackId);
            } else if (cleanCmd.modifier === 'stop') {
                this.stopAudio(trackId);
            }

            const entry = this.tracks.get(trackId);
            console.log('[DreamRun][audio][state]', trackId, {
                hasSource: !!entry?.source,
                isPausing: entry?.isPausing,
                pausedAt: entry?.pausedAt,
                lastVolume: entry?.lastVolume,
                gainValue: entry?.gainNode?.gain?.value,
                ctxState: this.audioContext.state,
            });
        }
    }

    /**
     * Sets the overall output level for the manager.
     */
    setMasterVolume(value) {
        const v = Math.max(0, Math.min(1, Number(value)));
        if (!Number.isFinite(v)) return;
        this._pendingMasterVolume = v;
        if (this.masterGain && this.audioContext) {
            this.masterGain.gain.setValueAtTime(v, this.audioContext.currentTime);
        }
    }

    /**
     * Stops a track with a short exponential fade-out to avoid clicks.
     * The entry is removed from the pool.
     */
    stopAudio(id) {
        const entry = this.tracks.get(id);
        if (!entry) return;

        const now = this.audioContext.currentTime;
        const fadeTime = 0.04;

        try {
            if (entry.source) entry.source.onended = null;
            if (entry.gainNode) {
                const currentVol = entry.gainNode.gain.value;
                entry.gainNode.gain.cancelScheduledValues(now);
                const startVol = currentVol > 0 ? currentVol : 0.001;
                entry.gainNode.gain.setValueAtTime(startVol, now);
                entry.gainNode.gain.exponentialRampToValueAtTime(0.001, now + fadeTime);
            }

            const sourceRef = entry.source;
            const gainRef = entry.gainNode;
            setTimeout(() => {
                try { if (sourceRef) { sourceRef.stop(); sourceRef.disconnect(); } } catch {}
                try { if (gainRef) gainRef.disconnect(); } catch {}
            }, fadeTime * 1000);
        } catch {}

        this.tracks.delete(id);
    }

    /**
     * Stops every active track and clears the pool. Called on game
     * end, on reset, and before replaying a loaded save.
     */
    clearAll() {
        const ids = Array.from(this.tracks.keys());
        for (const id of ids) this.stopAudio(id);
        this.tracks.clear();
    }

    /**
     * Enforces structural initialization of the global AudioContext instance.
     * Leverages an atomic promise lock to safely handle rapid sequential or batch invocations.
     */
    async _ensureContext() {
        if (typeof window === 'undefined') return;

        // If an initialization task is already in flight, reuse its promise to prevent race conditions
        if (this._contextPromise) {
            return this._contextPromise;
        }

        this._contextPromise = (async () => {
            if (!this.audioContext) {
                const Ctx = window.AudioContext || window.webkitAudioContext;
                if (!Ctx) {
                    console.warn('[DreamRun][audio] Web Audio API is not supported.');
                    return;
                }
                // Atomically instantiate the base audio context runtime container
                this.audioContext = new Ctx();
            }

            if (!this.masterGain) {
                this.masterGain = this.audioContext.createGain();
                this.masterGain.gain.value = this._pendingMasterVolume;
                this.masterGain.connect(this.audioContext.destination);
            }

            if (this.audioContext.state === 'suspended') {
                try {
                    await this.audioContext.resume();
                } catch (e) {
                    console.warn('[DreamRun][audio] Failed to resume AudioContext:', e);
                }
            }
        })();

        return this._contextPromise;
    }

    /**
     * Resolves, decodes, and caches binary high-density audio array streams over network nodes.
     */
    async _loadBuffer(url) {
        // Enforce safe context verification synchronization boundary
        if (!this.audioContext) {
            await this._ensureContext();
            if (!this.audioContext) {
                throw new Error(`AUDIO_CONTEXT_NOT_READY: Cannot decode stream data for "${url}"`);
            }
        }

        if (this.bufferCache.has(url)) return this.bufferCache.get(url);
        if (this._pendingLoads?.has(url)) return this._pendingLoads.get(url);
        this._pendingLoads ??= new Map();

        const promise = (async () => {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status} while fetching ${url}`);
            const arrayBuffer = await response.arrayBuffer();
            
            // Safe decoding execution wrapper targeting the fully verified audioContext reference
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            this.bufferCache.set(url, audioBuffer);
            this._pendingLoads.delete(url);
            return audioBuffer;
        })();

        this._pendingLoads.set(url, promise);
        return promise;
    }

    async _startTrack(cmd) {
        const { modifier, id } = cmd;
        if (!cmd.path || cmd.path.startsWith('MISSING:')) {
            console.warn(`[DreamRun][audio] Missing asset id=${id}: ${cmd.path}`);
            return;
        }

        const srcUrl = cmd.path;

        const existing = this.tracks.get(id);
        if (existing) this.stopAudio(id);

        let audioBuffer;
        try {
            audioBuffer = await this._loadBuffer(srcUrl);
        } catch (e) {
            console.error(`[DreamRun][audio] Load failed id=${id}: ${srcUrl}`, e);
            return;
        }

        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.loop = modifier === 'music';

        const gainNode = this.audioContext.createGain();
        source.connect(gainNode);
        gainNode.connect(this.masterGain);

        const initialVolume = (cmd.volume && typeof cmd.volume === 'object' && cmd.volume.from != null)
            ? cmd.volume.from
            : (typeof cmd.volume === 'number' ? cmd.volume : 1.0);

        const initialPitch = (cmd.pitch && typeof cmd.pitch === 'object' && cmd.pitch.from != null)
            ? cmd.pitch.from
            : (typeof cmd.pitch === 'number' ? cmd.pitch : 1.0);

        const now = this.audioContext.currentTime;
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(initialVolume, now);
        source.playbackRate.cancelScheduledValues(now);
        source.playbackRate.setValueAtTime(initialPitch, now);

        this._applyParam(gainNode.gain, cmd.volume, initialVolume);
        this._applyParam(source.playbackRate, cmd.pitch, initialPitch);

        if (modifier !== 'music') {
            source.onended = () => {
                const entry = this.tracks.get(id);
                if (entry && entry.source === source) {
                    try { source.disconnect(); } catch {}
                    try { gainNode.disconnect(); } catch {}
                    this.tracks.delete(id);
                }
            };
        }

        const startOffset = Number.isFinite(cmd.start_offset) ? cmd.start_offset : 0;
        try {
            source.start(now, startOffset);
            console.log('[DreamRun][audio][start]', id, {
                url: srcUrl,
                duration: audioBuffer.duration,
                gainValue: gainNode.gain.value,
                ctxState: this.audioContext.state,
                ctxTime: now,
            });
        } catch (e) {
            console.error(`[DreamRun][audio] Failed to start id=${id}:`, e);
            return;
        }

        this.tracks.set(id, {
            source,
            gainNode,
            modifier,
            buffer: audioBuffer,
            path: srcUrl,
            startedAt: now - startOffset,
            pausedAt: null,
            lastPitch: this._resolveScalar(cmd.pitch, initialPitch),
            lastVolume: this._resolveScalar(cmd.volume, initialVolume),
        });
    }

    _modifyTrack(cmd) {
        const { id } = cmd;
        const entry = this.tracks.get(id);
        if (!entry) return;

        const currentPhysicalPitch = entry.lastPitch ?? 1.0;
        const currentPhysicalVolume = entry.lastVolume ?? 1.0;

        if (entry.source && cmd.pitch !== null && cmd.pitch !== undefined) {
            let pitchPayload = this._normalizePayload(cmd.pitch, currentPhysicalPitch);
            if (typeof pitchPayload === 'object' && (pitchPayload.from === undefined || pitchPayload.from === null)) {
                pitchPayload.from = currentPhysicalPitch;
            }
            this._applyParam(entry.source.playbackRate, pitchPayload, currentPhysicalPitch);
            entry.lastPitch = this._resolveScalar(pitchPayload, currentPhysicalPitch);
        }

        if (entry.gainNode && cmd.volume !== null && cmd.volume !== undefined) {
            let volumePayload = this._normalizePayload(cmd.volume, currentPhysicalVolume);
            if (typeof volumePayload === 'object' && (volumePayload.from === undefined || volumePayload.from === null)) {
                volumePayload.from = currentPhysicalVolume;
            }
            this._applyParam(entry.gainNode.gain, volumePayload, currentPhysicalVolume);
            entry.lastVolume = this._resolveScalar(volumePayload, currentPhysicalVolume);
        }
    }

    _normalizePayload(payload, defaultFrom) {
        if (typeof payload === 'string') {
            const parsed = parseAnimatedValue(payload, defaultFrom);
            if (typeof parsed === 'number') return { value: parsed, duration_ms: 0 };
            if (parsed && typeof parsed === 'object') {
                return { to: parsed.to, duration_ms: parsed.duration_ms, from: parsed.from ?? defaultFrom };
            }
        }

        if (payload && typeof payload === 'object' && 'value' in payload && !('to' in payload)) {
            return { to: payload.value, duration_ms: payload.duration_ms ?? 0, from: defaultFrom };
        }

        return payload;
    }

    _resolveScalar(payload, fallback) {
        if (typeof payload === 'number' && Number.isFinite(payload)) return payload;
        if (payload && typeof payload === 'object') {
            if (typeof payload.value === 'number' && Number.isFinite(payload.value)) return payload.value;
            if (typeof payload.to === 'number' && Number.isFinite(payload.to)) return payload.to;
        }
        return fallback;
    }

    _applyParam(param, payload, fallback) {
        const safe = (x, fb) => (typeof x === 'number' && Number.isFinite(x)) ? x : fb;
        const now = this.audioContext.currentTime;

        if (payload === null || payload === undefined) {
            param.cancelScheduledValues(now);
            param.setValueAtTime(safe(fallback, 0), now);
            return;
        }

        if (typeof payload === 'number') {
            param.cancelScheduledValues(now);
            param.setValueAtTime(safe(payload, safe(fallback, 0)), now);
            return;
        }

        if (typeof payload !== 'object') {
            param.cancelScheduledValues(now);
            param.setValueAtTime(safe(fallback, 0), now);
            return;
        }

        if ('to' in payload) {
            const fromV = (payload.from !== undefined && payload.from !== null)
                ? safe(payload.from, safe(fallback, 0))
                : safe(fallback, 0);
            const toV = safe(payload.to, fromV);
            const durS = safe(payload.duration_ms, 0) / 1000;

            param.cancelScheduledValues(now);
            param.setValueAtTime(fromV, now);
            if (durS > 0) {
                param.linearRampToValueAtTime(toV, now + durS);
            } else {
                param.setValueAtTime(toV, now);
            }
            return;
        }

        if ('value' in payload) {
            param.cancelScheduledValues(now);
            param.setValueAtTime(safe(payload.value, safe(fallback, 0)), now);
            return;
        }

        param.cancelScheduledValues(now);
        param.setValueAtTime(safe(fallback, 0), now);
    }

    _pauseTrack(id) {
        const entry = this.tracks.get(id);
        if (!entry || !entry.source) return;
        if (entry.isPausing) return;

        entry.isPausing = true;

        const now = this.audioContext.currentTime;
        const fadeTime = 0.05;

        if (entry.gainNode) {
            entry.gainNode.gain.cancelScheduledValues(now);
            entry.gainNode.gain.setValueAtTime(entry.gainNode.gain.value, now);
            entry.gainNode.gain.exponentialRampToValueAtTime(0.001, now + fadeTime);
        }

        entry.pauseTimeoutId = setTimeout(() => {
            if (!entry.isPausing) return;
            try {
                if (entry.source) {
                    const elapsed = this.audioContext.currentTime - (entry.startedAt ?? 0);
                    entry.pausedAt = (entry.pausedAt ?? 0) + elapsed;
                    entry.startedAt = null;
                    entry.source.stop();
                    entry.source.disconnect();
                    entry.source = null;
                }
            } catch {}
            entry.isPausing = false;
        }, fadeTime * 1000);
    }

    _resumeTrack(id) {
        const entry = this.tracks.get(id);
        if (!entry) return;

        // If a pause fade is in progress, cancel it and fade back up
        // without touching the source. This must be checked before the
        // source-exists test, because during the pause fade the source
        // is still alive — it is only stopped when the fade timeout
        // fires. Replay applies pause and resume in the same tick, so
        // the timeout has not run yet and the source is still present.
        if (entry.isPausing) {
            clearTimeout(entry.pauseTimeoutId);
            entry.isPausing = false;
            const now = this.audioContext.currentTime;
            entry.gainNode.gain.cancelScheduledValues(now);
            entry.gainNode.gain.linearRampToValueAtTime(entry.lastVolume ?? 1.0, now + 0.02);
            return;
        }

        // Already playing and not pausing: nothing to do.
        if (entry.source) return;

        // Otherwise, create a fresh source and start it from the saved
        // offset.
        const source = this.audioContext.createBufferSource();
        source.buffer = entry.buffer;
        source.playbackRate.value = entry.lastPitch ?? 1.0;
        source.loop = entry.modifier === 'music';

        source.connect(entry.gainNode);

        const now = this.audioContext.currentTime;
        entry.gainNode.gain.cancelScheduledValues(now);
        entry.gainNode.gain.setValueAtTime(0.001, now);
        entry.gainNode.gain.linearRampToValueAtTime(entry.lastVolume ?? 1.0, now + 0.02);

        const resumeOffset = entry.pausedAt ?? 0;
        try {
            console.log('[DreamRun][audio][resume]', id, {
                resumeOffset,
                lastVolume: entry.lastVolume,
                ctxState: this.audioContext.state,
            });
            source.start(0, resumeOffset);
        } catch (e) {
            console.error(`[DreamRun][audio] Failed to resume id=${id}:`, e);
            return;
        }

        entry.source = source;
        entry.startedAt = this.audioContext.currentTime - resumeOffset;
        entry.pausedAt = null;
    }
}