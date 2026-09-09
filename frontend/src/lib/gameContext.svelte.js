import { getContext, setContext } from 'svelte';
import { env } from '$env/dynamic/public';

class GameState {
    publicApiUrl = env.PUBLIC_API_URL;

    currentScreen = $state('MENU');

    sessionId = $state('');
    hasNext = $state(false);

    currentBg = $state('');
    currentSpeaker = $state(null);
    currentText = $state('');

    playerVariables = $state({});
    textSpeed = $state(7);

    errorData = $state({
        status: 'None',
        message: 'None',
        details: 'None'
    });

    isAnimating = $state(false);
    isLoading = $state(false);

    // Indicates that the current dialogue can be advanced by the player.
    pendingNextStep = $state(false);

    // Indicates that the game is currently running.
    isGameStarted = $state(false);

    // Dialogues received from the backend in the current prefetch block.
    dialogueQueue = $state([]);

    // Used to invalidate old requests when a new game starts.
    requestGeneration = 0;

    constructor() {
        if (typeof window !== 'undefined') {
            const savedSpeed = localStorage.getItem('dreamrun_text_speed');

            if (savedSpeed) {
                this.textSpeed = parseInt(savedSpeed, 10);
            }

            $effect.root(() => {
                $effect(() => {
                    localStorage.setItem(
                        'dreamrun_text_speed',
                        this.textSpeed.toString()
                    );
                });
            });
        }
    }

    getVariable(key, fallback = null) {
        return this.playerVariables[key] !== undefined
            ? this.playerVariables[key]
            : fallback;
    }

    showError(status, message, details) {
        this.errorData = {
            status,
            message,
            details
        };

        this.currentScreen = 'ERROR';
        this.isLoading = false;
        this.pendingNextStep = false;
        this.isGameStarted = false;
        this.dialogueQueue = [];
        this.sessionId = '';
    }

    async parseAndShowBackendError(response) {
        try {
            const errorJson = await response.json();

            if (
                errorJson.detail &&
                typeof errorJson.detail === 'object'
            ) {
                this.showError(
                    errorJson.detail.status ||
                        response.status.toString(),

                    errorJson.detail.message ||
                        `Backend error: ${response.statusText}`,

                    errorJson.detail.details || 'None'
                );
            } else {
                this.showError(
                    response.status.toString(),
                    `Backend error: ${response.statusText}`,
                    errorJson.detail ||
                        JSON.stringify(errorJson)
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

    /**
     * Applies a background path received from the backend.
     */
    processBackground(bg) {
        if (!bg) {
            return;
        }

        if (bg.startsWith('/assets')) {
            this.currentBg = `${this.publicApiUrl}${bg}`;
        } else {
            this.currentBg = bg;
        }
    }

    /**
     * Displays one dialogue received from the backend.
     *
     * Backend now sends plaintext dialogue:
     *
     * {
     *     type: "dialogue",
     *     name: "Alice",
     *     text: "Hello!",
     *     bg: "/assets/background.png"
     * }
     */
    processDialogue(dialogue) {
        if (!dialogue) {
            return;
        }

        if (dialogue.bg) {
            this.processBackground(dialogue.bg);
        }

        this.currentSpeaker = dialogue.name || null;
        this.currentText = dialogue.text || '';

        this.pendingNextStep = true;
        this.isGameStarted = true;
    }

    /**
     * Processes a complete prefetch block received from the backend.
     *
     * The backend returns:
     *
     * {
     *     "steps": [
     *         {
     *             "type": "dialogue",
     *             "name": "...",
     *             "text": "...",
     *             "bg": "..."
     *         },
     *         ...
     *     ]
     * }
     *
     * The first dialogue is displayed immediately.
     * Remaining dialogues are kept locally and do not require
     * additional HTTP requests.
     */
    processBlock(steps) {
        if (!Array.isArray(steps) || steps.length === 0) {
            this.handleGameEnd();
            return;
        }

        const dialogues = steps.filter(
            step => step && step.type === 'dialogue'
        );

        if (dialogues.length === 0) {
            this.handleGameEnd();
            return;
        }

        this.dialogueQueue = dialogues.slice(1);

        this.processDialogue(dialogues[0]);
    }

    /**
     * Resets all runtime state before starting a new game.
     */
    resetGameState() {
        this.sessionId = '';

        this.currentBg = '';
        this.currentSpeaker = null;
        this.currentText = '';

        this.playerVariables = {};

        this.pendingNextStep = false;
        this.isGameStarted = false;

        this.dialogueQueue = [];

        this.hasNext = false;

        this.errorData = {
            status: 'None',
            message: 'None',
            details: 'None'
        };
    }

    /**
     * Completely terminates the current game.
     */
    handleGameEnd() {
        this.currentScreen = 'MENU';

        this.pendingNextStep = false;
        this.isGameStarted = false;

        this.currentBg = '';
        this.currentSpeaker = null;
        this.currentText = '';

        this.dialogueQueue = [];

        this.sessionId = '';
        this.hasNext = false;
    }

    /**
     * Advances to the next dialogue.
     *
     * First consumes the local prefetch queue.
     * Only when the queue is empty does it request another
     * block from the backend.
     */
    async nextStep() {
        if (!this.isGameStarted) {
            return;
        }

        /*
         * We already have prefetched dialogues.
         * No backend request is necessary.
         */
        if (this.dialogueQueue.length > 0) {
            const nextDialogue = this.dialogueQueue.shift();

            this.processDialogue(nextDialogue);

            return;
        }

        /*
         * Prevent duplicate backend requests.
         */
        if (this.isLoading) {
            return;
        }

        if (!this.sessionId) {
            return;
        }

        this.isLoading = true;
        this.pendingNextStep = false;

        const generation = this.requestGeneration;

        try {
            const response = await fetch(
                `${this.publicApiUrl}/api/game/next`,
                {
                    method: 'POST',
                    headers: {
                        'X-Session-ID': this.sessionId
                    }
                }
            );

            /*
             * A new game may have been started while this request
             * was still in flight.
             *
             * In that case this response belongs to the old game
             * and must be ignored.
             */
            if (generation !== this.requestGeneration) {
                return;
            }

            if (!response.ok) {
                await this.parseAndShowBackendError(response);
                return;
            }

            const data = await response.json();

            /*
             * Backend may update runtime variables after executing
             * Python/config steps.
             */
            if (data.variables) {
                this.playerVariables = data.variables;
            }

            /*
             * The backend now returns a block instead of one step.
             */
            this.processBlock(data.steps);

        } catch (err) {
            if (generation !== this.requestGeneration) {
                return;
            }

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

    /**
     * Handles a click on the game screen.
     *
     * GameScreen should call this only after text animation
     * has finished.
     */
    async handleClick() {
        if (!this.pendingNextStep) {
            return;
        }

        if (this.isLoading) {
            return;
        }

        await this.nextStep();
    }

    /**
     * Starts a completely new game session.
     */
    async startGame() {
        if (!this.publicApiUrl) {
            this.showError(
                'ENV_MISSING_ERROR',
                'The .env setup configuration is missing.',
                ''
            );

            return;
        }

        /*
         * Invalidate all previous asynchronous requests.
         */
        this.requestGeneration += 1;

        const generation = this.requestGeneration;

        /*
         * Reset old game data before creating a new session.
         */
        this.resetGameState();

        this.isLoading = true;

        try {
            const response = await fetch(
                `${this.publicApiUrl}/api/game/start`,
                {
                    method: 'POST'
                }
            );

            /*
             * Ignore response if another game was started.
             */
            if (generation !== this.requestGeneration) {
                return;
            }

            if (!response.ok) {
                await this.parseAndShowBackendError(response);
                return;
            }

            const data = await response.json();

            /*
             * Store the newly created backend session.
             */
            this.sessionId = data.session_id;

            /*
             * Load initial runtime variables.
             */
            this.playerVariables = data.variables || {};

            /*
             * Switch to the game screen before displaying
             * the first dialogue.
             */
            this.currentScreen = 'GAME';

            /*
             * Backend returns "steps", not "step".
             */
            this.processBlock(data.steps);

        } catch (err) {
            if (generation !== this.requestGeneration) {
                return;
            }

            this.showError(
                'FETCH_ERROR',
                'Backend connection error.',
                err?.message || String(err)
            );
        } finally {
            if (generation === this.requestGeneration) {
                this.isLoading = false;
            }
        }
    }
}

const GAME_CONTEXT_KEY = Symbol('GAME_CONTEXT');

export function initGameContext() {
    return setContext(
        GAME_CONTEXT_KEY,
        new GameState()
    );
}

export function useGameContext() {
    return getContext(GAME_CONTEXT_KEY);
}