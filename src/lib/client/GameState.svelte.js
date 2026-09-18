import { AudioManager } from './AudioManager.svelte';

/**
 * Main game runtime state manager built on Svelte 5 Runes.
 * Coordinates atomic image preloading, stylesheet decryption caching,
 * and gapless Web Audio context pipelines.
 */
export class GameState {
    audioManager = new AudioManager();

    currentScreen = $state('MENU');
    sessionId = $state('');
    hasNext = $state(false);

    // Reactive array managing state-driven displayable overlay nodes
    activeImages = $state([]);
    cssBlobCache = new Map(); // url -> local Blob URL memory reference

    currentSpeaker = $state(null);
    currentText = $state('');
    currentChoices = $state([]);

    pauseActive = $state(false);
    pauseTimerId = null;

    playerVariables = $state({});
    textSpeed = $state(7);

    errorData = $state({ status: 'None', message: 'None', details: 'None' });
    isAnimating = $state(false);
    isLoading = $state(false);
    pendingNextStep = $state(false);

    showLoadingUI = $state(false);
    loadingTimeoutId = null;

    isGameStarted = $state(false);
    dialogueQueue = $state([]);
    requestGeneration = 0;
    currentDialogue = $state(null);

    constructor() {
        if (typeof window !== 'undefined') {
            const savedSpeed = localStorage.getItem('dreamrun_text_speed');
            if (savedSpeed) this.textSpeed = parseInt(savedSpeed, 10);
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
        this.pendingNextStep = false;
        this.isGameStarted = false;
        this.dialogueQueue = [];
        this.currentChoices = [];
        this.currentDialogue = null;
        if (this.pauseTimerId) {
            clearTimeout(this.pauseTimerId);
            this.pauseTimerId = null;
        }
        this.pauseActive = false;
        this.sessionId = '';
    }

    async parseAndShowBackendError(response) {
        let rawText = '';
        let payload = null;

        try {
            rawText = await response.text();
            payload = rawText ? JSON.parse(rawText) : null;
        } catch {
            payload = null;
        }

        const status = response.status.toString();

        // Preferred shape: { detail: { status, message, details } }
        if (payload && payload.detail && typeof payload.detail === 'object') {
            this.showError(
                payload.detail.status || status,
                payload.detail.message || `Backend error: ${response.statusText}`,
                payload.detail.details || 'None'
            );
            return;
        }

        // Fallback for SvelteKit's default shape: { message: "..." }
        if (payload && payload.message) {
            this.showError(
                status,
                payload.message,
                rawText || 'None'
            );
            return;
        }

        // Last resort: dump the raw body so nothing is lost.
        this.showError(
            status,
            `Backend error: ${response.statusText}`,
            rawText || 'None'
        );
    }

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

    processDialogue(dialogue) {
        if (!dialogue) return;

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

    async processBlock(steps) {
        if (!Array.isArray(steps) || steps.length === 0) {
            this.handleGameEnd();
            return;
        }

        try {
            const audioTargets = [];
            const styleTargets = [];

            for (const step of steps) {
                if (!step) continue;

                if (Array.isArray(step.audio)) {
                    for (const cmd of step.audio) {
                        if ((cmd.modifier === 'sound' || cmd.modifier === 'music')
                            && cmd.path && !cmd.path.startsWith('MISSING:')) {
                            audioTargets.push(cmd.path);
                        }
                    }
                }

                if (Array.isArray(step.images)) {
                    for (const cmd of step.images) {
                        if (cmd.img_path && !cmd.img_path.startsWith('MISSING:')) {
                            styleTargets.push(fetch(cmd.img_path).catch(() => {}));
                        }
                        if (cmd.container_css && cmd.container_css !== 'none') {
                            styleTargets.push(this.decryptAndLoadStyle(cmd.container_css));
                        }
                        if (cmd.image_css && cmd.image_css !== 'none') {
                            styleTargets.push(this.decryptAndLoadStyle(cmd.image_css));
                        }
                    }
                }
            }

            await Promise.all([
                this.audioManager.preloadAudioBuffers(audioTargets),
                ...styleTargets,
            ]);
        } catch (err) {
            console.warn('[DreamRun][preload] Asset hydration fallback:', err);
        }

        if (steps[0] && steps[0].type === 'choice') {
            this.processDialogue(steps[0]);
            this.dialogueQueue = [];
            return;
        }

        const filteredNodes = steps.filter(step =>
            step && (step.type === 'dialogue' || step.type === 'choice' || step.type === 'pause' || step.type === 'image')
        );

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
            const response = await fetch('/api/game/choice', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-ID': this.sessionId,
                },
                body: JSON.stringify({ choice_index: choiceIndex }),
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
                'Failed to submit choice.',
                err?.message || String(err)
            );
        } finally {
            if (generation === this.requestGeneration) this.stopLoadingState();
        }
    }

    async nextStep() {
        if (this.pauseActive) return;
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
            const response = await fetch('/api/game/next', {
                method: 'POST',
                headers: { 'X-Session-ID': this.sessionId },
            });

            if (generation !== this.requestGeneration) return;
            if (!response.ok) {
                await this.parseAndShowBackendError(response);
                return;
            }

            const data = await response.json();
            if (data.variables) this.playerVariables = data.variables;

            if (data.steps && data.steps.some(s => s.type === 'change_act')) {
                this.clearBlobCache();
            }

            await this.processBlock(data.steps);
        } catch (err) {
            if (generation !== this.requestGeneration) return;
            this.showError(
                'GAME_FETCH_ERROR',
                'Failed to advance sequence frames.',
                err?.message || String(err)
            );
        } finally {
            if (generation === this.requestGeneration) this.stopLoadingState();
        }
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
        const generation = this.requestGeneration;

        this.resetGameState();
        this.startLoadingState();

        try {
            const response = await fetch('/api/game/start', { method: 'POST' });
            if (generation !== this.requestGeneration) return;

            if (!response.ok) {
                await this.parseAndShowBackendError(response);
                return;
            }

            const data = await response.json();
            this.sessionId = data.session_id;
            this.playerVariables = data.variables || {};

            // Perform 100% of asset hydration preloading PRIOR to changing screens
            await this.processBlock(data.steps);

            // Change screen to active context only after assets are firmly bound into local memory
            if (generation === this.requestGeneration) {
                this.currentScreen = 'GAME';
            }
        } catch (err) {
            if (generation !== this.requestGeneration) return;
            this.showError(
                'FETCH_ERROR',
                'Backend connection error.',
                err?.message || String(err)
            );
        } finally {
            if (generation === this.requestGeneration) this.stopLoadingState();
        }
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
        this.dialogueQueue = [];
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
        this.dialogueQueue = [];
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
}