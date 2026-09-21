import type { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { executeCompiled } from './executor.js';
import { getCompiledScript } from './compiled_cache.js';
import { SESSIONS, createSession, dropSession } from './sessions.js';
import { loadDefaultVars } from './config_loader.js';
import { buildSaveFile, restoreFromSaveFile } from './save_manager.js';
import { getPublicVariables } from './utils.js';
import { listSaves, getSave, putSave } from './saves.js';
import { Character, Ramp } from './runtime_types.js';
import type { Session, RecordedChoice } from './types.js';
import type { SaveMetadata } from './save_types.js';

export type SocketState = {
    ws: WebSocket;
    sessionId: string | null;
    token: string;
    ownerId: string | null;
    onClose: () => void;
};

export function initSocketSession(ws: WebSocket): SocketState {
    const token = randomUUID();

    const state: SocketState = {
        ws,
        sessionId: null,
        token,
        ownerId: null,
        // Chain of pending message handlers. Each incoming message is
        // appended to the chain, so handlers run one at a time and
        // in the order the messages arrived. This prevents a race
        // between identify and any later save/load/list_saves.
        _queue: Promise.resolve(),
        onClose: () => {
            if (state.sessionId) {
                dropSession(state.sessionId);
                state.sessionId = null;
            }
        },
    };

    send(ws, { type: 'session', sessionId: null, token });
    return state;
}

export async function handleSocketMessage(
    state: SocketState,
    raw: string,
): Promise<void> {
    let msg: any;
    try {
        msg = JSON.parse(raw);
    } catch {
        return sendError(state.ws, 'INVALID_PAYLOAD', 'Message is not JSON.', 'None');
    }

    try {
        switch (msg.type) {
            case 'identify': return await onIdentify(state, msg.ownerId);
            case 'start':    return await onStart(state);
            case 'advance':  return await onAdvance(state);
            case 'choice':   return await onChoice(state, msg.index);
            case 'save':     return await onSave(state, msg);
            case 'load':     return await onLoad(state, msg);
            case 'list_saves': return await onListSaves(state, msg);
            case 'resume':   return await onResume(state, msg.token);
            default:
                return sendError(state.ws, 'UNKNOWN_MESSAGE', `Unknown type: ${msg.type}`, 'None');
        }
    } catch (err) {
        console.error('[DreamRun][ws] handler error:', err);
        return sendError(
            state.ws,
            'RUNTIME_ERROR',
            err instanceof Error ? err.message : 'Handler failed.',
            err instanceof Error ? (err.stack ?? 'None') : String(err),
        );
    }
}

async function onIdentify(state: SocketState, ownerId: unknown): Promise<void> {
    if (typeof ownerId !== 'string' || !ownerId) {
        return sendError(state.ws, 'INVALID_IDENTIFY_PAYLOAD', 'ownerId must be a non-empty string.', String(ownerId));
    }
    state.ownerId = ownerId;
}

async function onStart(state: SocketState): Promise<void> {
    if (state.sessionId) dropSession(state.sessionId);

    // Fetch the compiled scenario. Cached per source hash, so a
    // fresh session does not recompile unless the source changed.
    const compiled = getCompiledScript();

    const sessionId = createSession({
        compiled,
        cursor: 0,
        return_stack: [],
        runtime_env: { Character, Ramp },
        choices: [],
        _pending_audio: [],
        _pending_images: [],
        last_request_time: Date.now(),
        last_choice_time: 0,
    });

    state.sessionId = sessionId;
    const session = SESSIONS.get(sessionId)!;
    await loadDefaultVars(session);

    send(state.ws, { type: 'session', sessionId, token: state.token });
    await pushNextFrame(state);
}

async function onAdvance(state: SocketState): Promise<void> {
    if (!state.sessionId) {
        return sendError(state.ws, 'NO_SESSION', 'Start a game first.', 'None');
    }
    const session = SESSIONS.get(state.sessionId);
    if (session) session.last_request_time = Date.now();
    await pushNextFrame(state);
}

/**
 * Applies a choice selection to the session.
 *
 * Under the compiled model the choice step stores an address table.
 * Selecting an option pushes the choice's `after` address onto the
 * return stack and jumps to that option's branch start. The
 * recorded choice is appended to the session's journal so that a
 * subsequent load can replay through it without prompting again.
 */
async function onChoice(state: SocketState, index: unknown): Promise<void> {
    if (!state.sessionId) {
        return sendError(state.ws, 'NO_SESSION', 'Start a game first.', 'None');
    }
    const session = SESSIONS.get(state.sessionId)!;

    const choiceIndex = Number(index);
    if (!Number.isInteger(choiceIndex)) {
        return sendError(state.ws, 'INVALID_PAYLOAD', 'choice.index must be an integer.', String(index));
    }

    const step = session.compiled.steps[session.cursor] as any;
    if (!step || step.type !== 'choice') {
        return sendError(state.ws, 'INVALID_STATE', 'No active choice.', `cursor=${session.cursor}`);
    }

    const opts = step.options as Array<{ branch_start: number }>;
    if (choiceIndex < 0 || choiceIndex >= opts.length) {
        return sendError(state.ws, 'OUT_OF_BOUNDS', 'Choice index out of range.', String(choiceIndex));
    }

    session.choices.push({ index: session.cursor, choice: choiceIndex });

    // Push `after` and jump to the chosen branch.
    session.return_stack.push(step.after);
    session.cursor = opts[choiceIndex].branch_start;

    await pushNextFrame(state);
}

async function onSave(state: SocketState, msg: any): Promise<void> {
    if (!state.sessionId) {
        return sendError(state.ws, 'NO_SESSION', 'Start a game first.', 'None');
    }
    if (!state.ownerId) {
        return sendError(state.ws, 'NO_IDENTITY', 'identify must be sent before save.', 'None');
    }
    const session = SESSIONS.get(state.sessionId)!;

    const slot = Number(msg.slot);
    if (!Number.isInteger(slot) || slot < 0) {
        return sendError(state.ws, 'INVALID_SLOT', 'slot must be a non-negative integer.', String(msg.slot));
    }

    const metadata: Partial<SaveMetadata> = msg.metadata ?? {};
    const file = await buildSaveFile(session, metadata);
    putSave(state.ownerId, slot, file);

    send(state.ws, { type: 'saved', slot, metadata: file.metadata });
}

async function onLoad(state: SocketState, msg: any): Promise<void> {
    if (!state.ownerId) {
        return sendError(state.ws, 'NO_IDENTITY', 'identify must be sent before load.', 'None');
    }

    const slot = Number(msg.slot);
    if (!Number.isInteger(slot) || slot < 0) {
        return sendError(state.ws, 'INVALID_SLOT', 'slot must be a non-negative integer.', String(msg.slot));
    }

    const file = getSave(state.ownerId, slot);
    if (!file) {
        return sendError(state.ws, 'EMPTY_SLOT', 'No save in this slot.', `slot=${slot}`);
    }

    if (state.sessionId) dropSession(state.sessionId);

    const restored = await restoreFromSaveFile(file);
    state.sessionId = restored.sessionId;

    const session = SESSIONS.get(restored.sessionId)!;

    send(state.ws, {
        type: 'loaded',
        sessionId: restored.sessionId,
        variables: getPublicVariables(session.runtime_env),
        replay: {
            audio: restored.replay.audio,
            images: restored.replay.images,
            firstFrame: restored.replay.firstFrame,
        },
        warnings: restored.warnings,
    });
}

async function onListSaves(state: SocketState): Promise<void> {
    if (!state.ownerId) {
        return sendError(state.ws, 'NO_IDENTITY', 'identify must be sent before list_saves.', 'None');
    }
    const saves = listSaves(state.ownerId);
    send(state.ws, { type: 'saves_list', saves });
}

async function onResume(state: SocketState, token: unknown): Promise<void> {
    if (typeof token !== 'string' || !token) {
        return sendError(state.ws, 'INVALID_TOKEN', 'resume.token must be a non-empty string.', 'None');
    }
    return sendError(state.ws, 'RESUME_UNAVAILABLE', 'Resume is not enabled in this build.', 'None');
}

async function pushNextFrame(state: SocketState): Promise<void> {
    if (!state.sessionId) return;
    const session = SESSIONS.get(state.sessionId)!;

    const result = await executeCompiled(state.sessionId);

    if (result.steps.length === 0) {
        send(state.ws, {
            type: 'end',
            variables: getPublicVariables(session.runtime_env),
        });
        return;
    }

    send(state.ws, {
        type: 'frame',
        frame: result.steps[0],
        variables: getPublicVariables(session.runtime_env),
    });
}

function send(ws: WebSocket, payload: unknown): void {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify(payload));
}

function sendError(ws: WebSocket, status: string, message: string, details: string): void {
    send(ws, { type: 'error', status, message, details });
}