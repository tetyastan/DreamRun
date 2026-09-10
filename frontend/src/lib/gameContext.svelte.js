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

    // Active choices list container placeholder array tracking slots
    currentChoices = $state([]);

    playerVariables = $state({});
    textSpeed = $state(7);

    errorData = $state({ status: 'None', message: 'None', details: 'None' });
    isAnimating = $state(false);
    isLoading = $state(false);
    pendingNextStep = $state(false);
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

    getVariable(key, fallback = null) {
        return this.playerVariables[key] !== undefined ? this.playerVariables[key] : fallback;
    }

    showError(status, message, details) {
        this.errorData = { status, message, details };
        this.currentScreen = 'ERROR';
        this.isLoading = false;
        this.pendingNextStep = false;
        this.isGameStarted = false;
        this.dialogueQueue = [];
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
        
        // Check if the server explicitly flagged this background asset as missing
        if (bg.startsWith('MISSING:')) {
            this.currentBg = bg; // Save the token verbatim for GameScreen UI parsing
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

        // Trigger step-attached audio tracks processor early before presentation rendering
        if (dialogue.audio) {
            this.audioManager.processAudioCommands(dialogue.audio, this.publicApiUrl);
        }

        // Catch dynamic choice node interruption block structures early
        if (dialogue.type === 'choice') {
            if (dialogue.bg) this.processBackground(dialogue.bg);
            this.currentChoices = dialogue.options || [];
            this.pendingNextStep = false; // Block dialogue skipping while choices are visible
            this.isGameStarted = true;
            return;
        }

        if (dialogue.bg) {
            this.processBackground(dialogue.bg);
        }

        this.currentSpeaker = dialogue.name || null;
        this.currentText = dialogue.text || '';
        this.currentChoices = []; // Clear old choices tracking data lists

        this.pendingNextStep = true;
        this.isGameStarted = true;
    }

    processBlock(steps) {
        if (!Array.isArray(steps) || steps.length === 0) {
            this.handleGameEnd();
            return;
        }

        // Intercept inline choice payloads directly from the root batch array node placement
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

    /**
     * Dispatches the player choice branch target directly back onto the authoritative stream.
     */
    async selectChoice(choiceIndex) {
        if (this.isLoading) return;
        this.isLoading = true;

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

            this.currentChoices = []; // Reset active choice presentation nodes
            this.processBlock(data.steps);

        } catch (err) {
            if (generation !== this.requestGeneration) return;
            this.showError(
                'CHOICE_SUBMIT_ERROR',
                'Failed to transmit structural decision index mapping frames.',
                err?.message || String(err)
            );
        } finally {
            if (generation === this.requestGeneration) {
                this.isLoading = false;
            }
        }
    }

    resetGameState() {
        this.audioManager.clearAll();
        this.sessionId = '';
        this.currentBg = '';
        this.currentSpeaker = null;
        this.currentText = '';
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
        this.currentText = '';
        this.dialogueQueue = [];
        this.currentChoices = [];
        this.sessionId = '';
        this.hasNext = false;
    }

    async nextStep() {
        if (!this.isGameStarted) return;
        if (this.currentChoices.length > 0) return; // Prevent advancing text manually if choice prompts await input actions

        if (this.dialogueQueue.length > 0) {
            const nextNode = this.dialogueQueue.shift();
            this.processDialogue(nextNode);
            return;
        }

        if (this.isLoading) return;
        if (!this.sessionId) return;

        this.isLoading = true;
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

            this.processBlock(data.steps);

        } catch (err) {
            if (generation !== this.requestGeneration) return;
            this.showError(
                'GAME_FETCH_ERROR',
                'Failed to advance sequence frames.',
                err?.message || String(err)
            );
        } finally {
            if (generation === this.requestGeneration) {
                this.isLoading = false;
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
        this.isLoading = true;

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

            this.processBlock(data.steps);

        } catch (err) {
            if (generation !== this.requestGeneration) return;
            this.showError('FETCH_ERROR', 'Backend connection error.', err?.message || String(err));
        } finally {
            if (generation === this.requestGeneration) {
                this.isLoading = false;
            }
        }
    }
}

class AudioManager {
    constructor() {
        this.activeAudioPool = new Map(); // Tracks active tracks: id -> HTMLAudioElement
    }

    /**
     * Executes a batch array of server authoritative audio runtime commands.
     */
    processAudioCommands(commands, publicApiUrl) {
        if (!Array.isArray(commands)) return;

        for (const cmd of commands) {
            const { modifier, id } = cmd;

            if (modifier === 'sound' || modifier === 'music') {
                // If the track is missing or invalid, print warning and continue safely
                if (cmd.path.startsWith('MISSING:')) {
                    console.warn(`[Audio Engine] Missing sound asset registration: ${cmd.path}`);
                    continue;
                }

                // If an item with this ID is already playing, clear it out first
                this.stopAudio(id);

                // Resolve full URL
                const srcUrl = cmd.path.startsWith('/assets') ? `${publicApiUrl}${cmd.path}` : cmd.path;
                
                const audio = new Audio(srcUrl);
                audio.volume = cmd.volume ?? 1.0;
                audio.playbackRate = cmd.pitch ?? 1.0;
                
                if (modifier === 'music') {
                    audio.loop = true;
                } else {
                    // Automatically drop references when standard one-shot sounds complete
                    audio.onended = () => {
                        this.activeAudioPool.delete(id);
                    };
                }

                audio.play().catch(err => console.error(`[Audio Engine] Playback failed for ID ${id}:`, err));
                this.activeAudioPool.set(id, audio);
            }

            else if (modifier === 'modify') {
                const audio = this.activeAudioPool.get(id);
                if (audio) {
                    if (cmd.volume !== null && cmd.volume !== undefined) audio.volume = cmd.volume;
                    if (cmd.pitch !== null && cmd.pitch !== undefined) audio.playbackRate = cmd.pitch;
                }
            }

            else if (modifier === 'pause') {
                const audio = this.activeAudioPool.get(id);
                if (audio) audio.pause();
            }

            else if (modifier === 'resume') {
                const audio = this.activeAudioPool.get(id);
                if (audio && audio.paused) {
                    audio.play().catch(err => console.error(`[Audio Engine] Resume failed for ID ${id}:`, err));
                }
            }

            else if (modifier === 'stop') {
                this.stopAudio(id);
            }
        }
    }

    stopAudio(id) {
        const audio = this.activeAudioPool.get(id);
        if (audio) {
            audio.pause();
            audio.currentTime = 0;
            this.activeAudioPool.delete(id);
        }
    }

    clearAll() {
        for (const id of this.activeAudioPool.keys()) {
            this.stopAudio(id);
        }
    }
}

const GAME_CONTEXT_KEY = Symbol('GAME_CONTEXT');

export function initGameContext() {
    return setContext(GAME_CONTEXT_KEY, new GameState());
}

export function useGameContext() {
    return getContext(GAME_CONTEXT_KEY);
}