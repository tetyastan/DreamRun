import { AudioManager } from './AudioManager.svelte';

/**
 * Main game runtime state manager built on Svelte 5 Runes.
 *
 * Talks to the server over a single WebSocket. Every gameplay
 * action — starting, advancing, choosing, saving, loading — is a
 * message on that socket. There are no HTTP calls.
 */
export class GameState {
    audioManager = new AudioManager();

    currentScreen = $state('MENU');
    sessionId = $state('');
    socket = null;

    saveMenuMode = $state('LOAD');
    saveMenuReturnTo = $state('MENU');
    saveMenuSlots = $state([]);

    hasNext = $state(false);
    activeImages = $state([]);
    cssBlobCache = new Map();

    currentSpeaker = $state(null);
    currentText = $state('');
    currentChoices = $state([]);

    pauseActive = $state(false);
    pauseTimerId = null;

    playerVariables = $state({});
    textSpeed = $state(7);
    masterVolume = $state(1.0);

    pendingScreenshot = null;

    errorData = $state({ status: 'None', message: 'None', details: 'None' });
    isLoading = $state(false);
    pendingNextStep = $state(false);

    showLoadingUI = $state(false);
    loadingTimeoutId = null;
    isGameStarted = $state(false);
    requestGeneration = 0;
    currentDialogue = $state(null);

    // Resolvers for request/response pairs. The socket protocol is
    // message-based, so any operation that needs a reply — save,
    // load, list_saves — registers a resolver keyed by message type
    // and awaits it.
    _pending = new Map();

    // Queue of messages sent before the socket opened. Flushed in order
    // on the open event. Any message that needs to reach the server —
    // identify, list_saves, save, load — goes through here rather than
    // being dropped silently.
    _queued = [];

    constructor() {
        if (typeof window !== 'undefined') {
            // A stable per-browser identifier. Generated once, stored in
            // localStorage, reused for every connection. It survives page
            // reloads and is what the server keys save slots on. Setting
            // it in the constructor rather than in connect() means
            // listSaves and loadGame work even before startGame has been
            // called — for example when the SaveMenu is opened from the
            // main menu.
            let ownerId = localStorage.getItem('dreamrun_owner_id');
            if (!ownerId) {
                ownerId = crypto.randomUUID();
                localStorage.setItem('dreamrun_owner_id', ownerId);
            }
            this.ownerId = ownerId;

            const savedSpeed = localStorage.getItem('dreamrun_text_speed');
            if (savedSpeed) this.textSpeed = parseInt(savedSpeed, 10);

            const savedVolume = localStorage.getItem('dreamrun_master_volume');
            if (savedVolume !== null) {
                const v = parseFloat(savedVolume);
                if (Number.isFinite(v)) this.masterVolume = Math.max(0, Math.min(1, v));
            }
            this.audioManager.setMasterVolume(this.masterVolume);

            $effect.root(() => {
                $effect(() => {
                    localStorage.setItem('dreamrun_text_speed', this.textSpeed.toString());
                });
                $effect(() => {
                    localStorage.setItem('dreamrun_master_volume', this.masterVolume.toString());
                    this.audioManager.setMasterVolume(this.masterVolume);
                });
            });
        }
    }

    // --- socket lifecycle --------------------------------------------

    /**
     * Opens the WebSocket and wires up the message dispatcher.
     *
     * Called once per session. The connection is reused for the
     * lifetime of the playthrough; starting a new game sends a
     * `start` message on the same socket rather than reconnecting.
     */
    connect() {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) return;

        const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/game`;
        this.socket = new WebSocket(url);
        this.socket.onmessage = (e) => this._onMessage(JSON.parse(e.data));
        this.socket.onopen = () => {
            this._send({ type: 'identify', ownerId: this.ownerId });
            this._flushQueue();
        };
        this.socket.onclose = () => {
            console.warn('[DreamRun][ws] closed');
            this.socket = null;
        };
        this.socket.onerror = (e) => {
            console.error('[DreamRun][ws] error', e);
        };
    }

    _send(payload) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(payload));
            return;
        }
        // Not open yet. Queue it; _flushQueue will send it on `open`.
        this._queued.push(payload);
    }

    _flushQueue() {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        const queue = this._queued;
        this._queued = [];
        for (const payload of queue) {
            this.socket.send(JSON.stringify(payload));
        }
    }

    /**
     * Registers a one-shot resolver for the next message of a given
     * type. Used for request/reply messages like save and load.
     */
    _await(type) {
        return new Promise((resolve) => {
            this._pending.set(type, resolve);
        });
    }

    _resolve(type, value) {
        const r = this._pending.get(type);
        if (r) {
            this._pending.delete(type);
            r(value);
        }
    }

    async _onMessage(msg) {
        // --- DEBUG ---
        console.log('[DreamRun][client][ws] message', msg.type, msg);
        // ------------
        switch (msg.type) {
            case 'session':
                // The first session message arrives at connect time with a null
                // id — the server does not create a session until `start`. A
                // second session message arrives immediately after `start` with
                // the real id. Both cases are handled here.
                if (msg.sessionId) this.sessionId = msg.sessionId;
                if (typeof sessionStorage !== 'undefined' && msg.token) {
                    sessionStorage.setItem('dreamrun_token', msg.token);
                }
                return;

            case 'frame':
                if (msg.variables) this.playerVariables = msg.variables;
                this.processDialogue(msg.frame);
                this.stopLoadingState();
                return;

            case 'end':
                if (msg.variables) this.playerVariables = msg.variables;
                this.stopLoadingState();
                this.handleGameEnd();
                return;

            case 'loaded':
                this.sessionId = msg.sessionId;
                this.playerVariables = msg.variables || {};
                await this.applyReplay(msg.replay);
                if (Array.isArray(msg.warnings) && msg.warnings.length > 0) {
                    console.warn('[DreamRun][load] warnings:', msg.warnings);
                }
                this._resolve('load', { ok: true, warnings: msg.warnings });
                return;

            case 'saved':
                this._resolve('save', { ok: true, metadata: msg.metadata });
                return;

            case 'saves_list':
                this.saveMenuSlots = msg.saves;
                this._resolve('list_saves', { ok: true, saves: msg.saves });
                return;

            case 'error':
                this._resolve('load', { ok: false, error: msg.status });
                this._resolve('save', { ok: false, error: msg.status });
                this._resolve('list_saves', { ok: false, error: msg.status });
                this.showError(msg.status, msg.message, msg.details);
                return;

            default:
                console.warn('[DreamRun][ws] unknown message', msg.type);
        }
    }

    // --- loading state -----------------------------------------------

    startLoadingState() {
        this.isLoading = true;
        this.showLoadingUI = false;
        if (this.loadingTimeoutId) clearTimeout(this.loadingTimeoutId);
        this.loadingTimeoutId = setTimeout(() => {
            if (this.isLoading) this.showLoadingUI = true;
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

    clearBlobCache() {
        for (const blobUrl of this.cssBlobCache.values()) {
            if (blobUrl) URL.revokeObjectURL(blobUrl);
        }
        this.cssBlobCache.clear();
    }

    getVariable(key, fallback = null) {
        return this.playerVariables[key] !== undefined ? this.playerVariables[key] : fallback;
    }

    showError(status, message, details) {
        this.errorData = { status, message, details };
        this.currentScreen = 'ERROR';
        this.stopLoadingState();
        this.audioManager.clearAll();
        this.pendingNextStep = false;
        this.isGameStarted = false;
        this.currentChoices = [];
        this.currentDialogue = null;
        if (this.pauseTimerId) {
            clearTimeout(this.pauseTimerId);
            this.pauseTimerId = null;
        }
        this.pauseActive = false;
        this.sessionId = '';
    }

    // --- styles and images -------------------------------------------

    async decryptAndLoadStyle(url) {
        if (!url) return null;
        if (this.cssBlobCache.has(url)) return this.cssBlobCache.get(url);
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const rawText = await response.text();
            const blob = new Blob([rawText], { type: 'text/css' });
            const blobUrl = URL.createObjectURL(blob);
            this.cssBlobCache.set(url, blobUrl);
            return blobUrl;
        } catch (e) {
            console.error(`[DreamRun][style] Fetch failed: ${url}`, e);
            return null;
        }
    }

    async processImageCommands(commands) {
        if (!Array.isArray(commands)) return;

        const getClassNameFromUrl = (url) => {
            if (!url || url === 'none') return '';
            const filename = url.substring(url.lastIndexOf('/') + 1);
            return filename.substring(0, filename.lastIndexOf('.')) || filename;
        };

        for (const cmd of commands) {
            const { modifier, id } = cmd;

            if (modifier === 'show') {
                const imgUrl = cmd.img_path || '';
                const containerClass = getClassNameFromUrl(cmd.container_css);
                const imageClass = getClassNameFromUrl(cmd.image_css);

                const [blobContainerStyle, blobImageStyle] = await Promise.all([
                    this.decryptAndLoadStyle(cmd.container_css),
                    this.decryptAndLoadStyle(cmd.image_css),
                ]);

                this.activeImages = this.activeImages.filter(img => img.id !== id);
                this.activeImages.push({
                    id,
                    imgUrl,
                    layer: cmd.layer ?? 10,
                    containerBlob: blobContainerStyle,
                    imageBlob: blobImageStyle,
                    containerClass,
                    imageClass,
                    containerCss: cmd.container_css || null,
                    imageCss: cmd.image_css || null,
                    isHiding: false,
                });
            } else if (modifier === 'modify') {
                const target = this.activeImages.find(img => img.id === id);
                if (target) {
                    if (cmd.img_path) target.imgUrl = cmd.img_path;
                    if (cmd.layer !== undefined) target.layer = cmd.layer;
                    if (cmd.container_css) {
                        target.containerBlob = await this.decryptAndLoadStyle(cmd.container_css);
                        target.containerClass = getClassNameFromUrl(cmd.container_css);
                    }
                    if (cmd.image_css) {
                        target.imageBlob = await this.decryptAndLoadStyle(cmd.image_css);
                        target.imageClass = getClassNameFromUrl(cmd.image_css);
                    }
                }
            } else if (modifier === 'hide') {
                const target = this.activeImages.find(img => img.id === id);
                if (target) target.isHiding = true;
            }
        }
    }

    // --- dialogue processing -----------------------------------------

    processDialogue(dialogue) {
        if (!dialogue) return;

        // --- DEBUG ---
        console.log('[DreamRun][client][processDialogue]', {
            type: dialogue?.type,
            name: dialogue?.name,
            text: dialogue?.text,
        });
        // -------------

        this.currentDialogue = dialogue;

        if (dialogue.type === 'game_end') {
            this.handleGameEnd();
            return;
        }

        if (Array.isArray(dialogue.audio) && dialogue.audio.length > 0) {
            this.audioManager.processAudioCommands(dialogue.audio);
        }
        if (Array.isArray(dialogue.images)) {
            this.processImageCommands(dialogue.images);
        }

        if (dialogue.type === 'choice') {
            this.currentChoices = dialogue.options || [];
            this.pendingNextStep = false;
            this.isGameStarted = true;
            return;
        }

        if (dialogue.type === 'pause') {
            this.currentSpeaker = null;
            this.currentText = '';
            this.currentChoices = [];

            const blockMode = dialogue.block === true;
            const duration = dialogue.duration || 0;

            this.pauseActive = true;
            this.pendingNextStep = !blockMode;
            this.isLoading = true;

            if (this.pauseTimerId) clearTimeout(this.pauseTimerId);

            this.pauseTimerId = setTimeout(() => {
                this.pauseTimerId = null;
                this.pauseActive = false;
                this.isLoading = false;
                this.pendingNextStep = true;
                this.nextStep();
            }, duration);

            return;
        }

        this.currentSpeaker = dialogue.name || null;
        this.currentText = dialogue.text || '';
        this.currentChoices = [];

        this.pendingNextStep = true;
        this.isGameStarted = true;
    }

    // --- gameplay ----------------------------------------------------

    async selectChoice(choiceIndex) {
        if (this.isLoading) return;
        this.startLoadingState();
        this.currentChoices = [];
        this._send({ type: 'choice', index: choiceIndex });
    }

    async nextStep() {
        if (this.pauseActive) return;
        if (!this.isGameStarted) return;
        if (this.currentChoices.length > 0) return;
        if (this.isLoading) return;

        this.startLoadingState();
        this.pendingNextStep = false;
        this._send({ type: 'advance' });
    }

    async handleClick() {
        if (this.pauseActive && !this.currentDialogue?.block) {
            if (this.pauseTimerId) {
                clearTimeout(this.pauseTimerId);
                this.pauseTimerId = null;
            }
            this.pauseActive = false;
            this.isLoading = false;
            this.pendingNextStep = true;
            await this.nextStep();
            return;
        }

        if (this.pauseActive) return;
        if (this.currentChoices.length > 0) return;
        if (!this.pendingNextStep) return;
        if (this.isLoading) return;
        await this.nextStep();
    }

    async startGame() {
        this.requestGeneration += 1;
        this.resetGameState();
        this.startLoadingState();

        this.connect();
        // Wait for the socket to open before sending `start`.
        const sendStart = () => this._send({ type: 'start' });
        if (this.socket.readyState === WebSocket.OPEN) {
            sendStart();
        } else {
            this.socket.addEventListener('open', sendStart, { once: true });
        }

        // The first `frame` message will clear loading state and
        // switch the screen.
        this.currentScreen = 'GAME';
    }

    resetGameState() {
        this.audioManager.clearAll();
        this.activeImages = [];
        this.clearBlobCache();
        this.sessionId = '';
        this.currentSpeaker = null;
        this.currentText = '';
        this.currentChoices = [];
        this.currentDialogue = null;
        if (this.pauseTimerId) {
            clearTimeout(this.pauseTimerId);
            this.pauseTimerId = null;
        }
        this.pauseActive = false;
        this.playerVariables = {};
        this.pendingNextStep = false;
        this.isGameStarted = false;
        this.hasNext = false;
        this.errorData = { status: 'None', message: 'None', details: 'None' };
    }

    handleGameEnd() {
        this.audioManager.clearAll();
        this.activeImages = [];
        this.clearBlobCache();
        this.currentScreen = 'MENU';
        this.pendingNextStep = false;
        this.isGameStarted = false;
        this.currentSpeaker = null;
        this.currentText = '';
        this.currentChoices = [];
        this.currentDialogue = null;
        if (this.pauseTimerId) {
            clearTimeout(this.pauseTimerId);
            this.pauseTimerId = null;
        }
        this.pauseActive = false;
        this.sessionId = '';
        this.hasNext = false;
    }

    // --- save / load -------------------------------------------------

    async saveGame(slot) {
        this.startLoadingState();
        const wait = this._await('save');

        // --- DEBUG ---
        console.log('[DreamRun][client][save] sending', {
            slot,
            currentText: this.currentText,
            currentSpeaker: this.currentSpeaker,
            ownerId: this.ownerId,
        });
        // ------------

        this._send({
            type: 'save',
            slot,
            metadata: {
                sceneName: this.currentSpeaker ?? null,
                screenshot: this.pendingScreenshot,
            },
        });
        const result = await wait;
        this.pendingScreenshot = null;
        this.stopLoadingState();
        return result;
    }

    async loadGame(slot) {
        this.startLoadingState();
        const wait = this._await('load');

        // --- DEBUG ---
        console.log('[DreamRun][client][load] sending', { slot });
        // ------------

        this._send({ type: 'load', slot });
        const result = await wait;

        // --- DEBUG ---
        console.log('[DreamRun][client][load] result', result);
        // ------------

        this.stopLoadingState();
        if (result.ok) this.currentScreen = 'GAME';
        return result;
    }

    /**
     * Requests the occupancy map and metadata descriptors for all save slots.
     * Explicitly appends the persistent ownerId to safeguard queries against early race conditions.
     */
    async listSaves() {
        const wait = this._await('list_saves');
        this._send({ type: 'list_saves' });
        return wait;
    }

    /**
     * Rebuilds the client scene from a replay journal.
     * Clears existing state vectors and bulk-dispatches commands to minimize promise context overhead.
     */
    async applyReplay(replay) {
        // --- DEBUG ---
        console.log('[DreamRun][client][replay] details', {
            images: replay?.images,
            audio: replay?.audio,
            firstFrame: replay?.firstFrame,
        });
        // ------------

        this.audioManager.clearAll();
        this.activeImages = [];
        this.clearBlobCache();

        if (!replay) return;

        // Process image layout matrix structures bulk configurations
        if (Array.isArray(replay.images) && replay.images.length > 0) {
            await this.processImageCommands(replay.images);
        }

        if (Array.isArray(replay.audio) && replay.audio.length > 0) {
            await this.audioManager.processAudioCommands(replay.audio);
        }

        if (replay.firstFrame) {
            this.processDialogue(replay.firstFrame);
        }

        // --- DEBUG ---
        console.log('[DreamRun][client][replay] finished', {
            currentText: this.currentText,
            currentSpeaker: this.currentSpeaker,
            activeImages_count: this.activeImages.length,
        });
        // ------------
    }
}