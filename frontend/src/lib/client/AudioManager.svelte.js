/**
 * Web Audio API based audio manager.
 * 
 * Replaces the previous HTMLAudioElement approach to guarantee
 * sample-accurate gapless looping for background music.
 * Placed at the top to secure visibility for dependent runtime classes.
 */
export class AudioManager {
    constructor() {
        this.audioContext = null;
        this.activeAudioPool = new Map();
        this.bufferCache = new Map();
        this.trackUrlById = new Map();
    }

    // Pre-loading pipeline: concurrently resolves, streams, and caches high-density binary arrays over unstable connections
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

    async processAudioCommands(commands) {
        if (!Array.isArray(commands) || commands.length === 0) return;
        await this._ensureContext();

        for (const cmd of commands) {
            const { modifier, id } = cmd;
            if (modifier === 'sound' || modifier === 'music') {
                await this._startTrack(cmd);
            } else if (modifier === 'modify') {
                this._modifyTrack(cmd);
            } else if (modifier === 'pause') {
                this._pauseTrack(id);
            } else if (modifier === 'resume') {
                this._resumeTrack(id);
            } else if (modifier === 'stop') {
                this.stopAudio(id);
            }
        }
    }

    stopAudio(id) {
        const entry = this.activeAudioPool.get(id);
        if (!entry) return;

        const now = this.audioContext.currentTime;
        const fadeTime = 0.04; // 40ms fade-out to completely eliminate audio clicks

        try {
            if (entry.source) {
                entry.source.onended = null;
            }
            if (entry.gainNode) {
                entry.gainNode.gain.cancelScheduledValues(now);
                entry.gainNode.gain.setValueAtTime(entry.gainNode.gain.value, now);
                entry.gainNode.gain.exponentialRampToValueAtTime(0.001, now + fadeTime);
            }

            setTimeout(() => {
                try {
                    if (entry.source) {
                        entry.source.stop();
                        entry.source.disconnect();
                    }
                    if (entry.gainNode) {
                        entry.gainNode.disconnect();
                    }
                } catch (e) {}
            }, fadeTime * 1000);
        } catch (e) {}

        this.activeAudioPool.delete(id);
        this.trackUrlById.delete(id);
    }

    clearAll() {
        const ids = Array.from(this.activeAudioPool.keys());
        for (const id of ids) {
            this.stopAudio(id);
        }
    }

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

    async _startTrack(cmd) {
        const { modifier, id } = cmd;
        if (!cmd.path || cmd.path.startsWith('MISSING:')) {
            console.warn(`[DreamRun][audio] Missing asset id=${id}: ${cmd.path}`);
            return;
        }

        const srcUrl = cmd.path;
        this.stopAudio(id);

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

        this._applyParam(gainNode.gain, cmd.volume, 1.0);
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

        const currentPhysicalPitch = entry.source
            ? entry.source.playbackRate.value
            : (entry.lastPitch ?? 1.0);
        const currentPhysicalVolume = entry.gainNode
            ? entry.gainNode.gain.value
            : (entry.lastVolume ?? 1.0);

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

    _applyParam(param, payload, fallback) {
        const safe = (x, fb) => (typeof x === 'number' && Number.isFinite(x)) ? x : fb;
        const now = this.audioContext.currentTime;

        if (payload === null || payload === undefined) {
            param.cancelScheduledValues(now);
            param.value = safe(fallback, 0);
            return;
        }

        if (typeof payload === 'number') {
            param.cancelScheduledValues(now);
            param.value = safe(payload, safe(fallback, 0));
            return;
        }

        if (typeof payload !== 'object') {
            param.cancelScheduledValues(now);
            param.value = safe(fallback, 0);
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
                param.value = toV;
            }
            return;
        }

        if ('value' in payload) {
            param.cancelScheduledValues(now);
            param.value = safe(payload.value, safe(fallback, 0));
            return;
        }

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

        const now = this.audioContext.currentTime;
        const fadeTime = 0.05;

        try {
            entry.source.onended = null;
            if (entry.gainNode) {
                entry.gainNode.gain.cancelScheduledValues(now);
                entry.gainNode.gain.setValueAtTime(entry.gainNode.gain.value, now);
                entry.gainNode.gain.exponentialRampToValueAtTime(0.001, now + fadeTime);
            }

            setTimeout(() => {
                try {
                    if (entry.source) {
                        const elapsed = this.audioContext.currentTime - (entry.startedAt ?? 0);
                        entry.pausedAt = (entry.pausedAt ?? 0) + elapsed;
                        entry.startedAt = null;
                        entry.source.stop();
                        entry.source.disconnect();
                        entry.source = null;
                    }
                } catch (e) {}
            }, fadeTime * 1000);
        } catch (e) {
            const elapsed = now - (entry.startedAt ?? 0);
            entry.pausedAt = (entry.pausedAt ?? 0) + elapsed;
            entry.startedAt = null;
            try { entry.source.stop(); } catch {}
            try { entry.source.disconnect(); } catch {}
            entry.source = null;
        }
    }

    _resumeTrack(id) {
        const entry = this.activeAudioPool.get(id);
        if (!entry) return;
        if (entry.source) return;

        const source = this.audioContext.createBufferSource();
        source.buffer = entry.buffer;
        source.playbackRate.value = entry.lastPitch ?? 1.0;
        source.loop = entry.modifier === 'music';

        source.connect(entry.gainNode);
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