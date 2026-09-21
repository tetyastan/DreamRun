import path from 'node:path';
import { SCENES_DIR } from './config.js';
import { getCompiledScript } from './compiled_cache.js';
import { SESSIONS, createSession } from './sessions.js';
import { serializeEnv, deserializeEnv } from './save_serializer.js';
import { encryptSave, decryptSave } from './save_crypto.js';
import { replayTo } from './executor.js';
import type { Session } from './types.js';
import type { Snapshot, SaveFile, SaveMetadata } from './save_types.js';

export const SNAPSHOT_VERSION = 3;

/**
 * Assembles a .dreamsave file from the current session.
 *
 * Under the compiled model a save is nothing more than a cursor, a
 * return stack, and the runtime environment. There is no replay,
 * no visited-acts list, no current-origin tree — the cursor points
 * into a flat array whose shape does not change.
 */
export async function buildSaveFile(
    session: Session,
    metadata: Partial<SaveMetadata>,
): Promise<SaveFile> {
    const env = session.runtime_env;
    const savestamp = typeof env['__savestamp__'] === 'string'
        ? (env['__savestamp__'] as string)
        : null;

    // The cursor is already positioned on the frame the player is
    // reading: executeCompiled increments it after dispatching a
    // visible step, and stops. To resume exactly on that frame we
    // save cursor - 1 if the previous step was visible.
    let saveCursor = session.cursor;
    if (saveCursor > 0) {
        const prev = session.compiled.steps[saveCursor - 1];
        if (prev && (prev.type === 'dialogue' || prev.type === 'pause')) {
            saveCursor -= 1;
        }
    }

    const snapshot: Snapshot = {
        version: SNAPSHOT_VERSION,
        cursor: saveCursor,
        return_stack: [...session.return_stack],
        choices: [...session.choices],
        runtime_env: serializeEnv(env),
        source_hash: session.compiled.source_hash,
    };

    const json = JSON.stringify(snapshot);
    const encrypted = await encryptSave(new TextEncoder().encode(json));

    return {
        magic: 'DREAMSAVE',
        version: SNAPSHOT_VERSION,
        metadata: {
            timestamp: Date.now(),
            savestamp,
            sceneName: metadata.sceneName ?? null,
            screenshot: metadata.screenshot ?? null,
        },
        payload: bytesToBase64(encrypted),
    };
}

export type RestoreResult = {
    sessionId: string;
    metadata: SaveMetadata;
    variables: Record<string, unknown>;
    replay: {
        audio: import('./types.js').AudioCommand[];
        images: import('./types.js').ImageCommand[];
        firstFrame: import('./types.js').Frame | null;
    };
    warnings: string[];
};

/**
 * Rebuilds a session from a .dreamsave file.
 *
 * The compiled scenario is fetched by source hash — the same hash
 * the snapshot was saved against. If the source files changed since
 * the save was taken, the loaded script is a different one, and the
 * cursor may not point where it did. The checksum embedded in the
 * snapshot is compared here; a mismatch produces a warning but the
 * session still loads.
 */
export async function restoreFromSaveFile(file: SaveFile): Promise<RestoreResult> {
    const warnings: string[] = [];

    if (file.magic !== 'DREAMSAVE') throw new Error('NOT_A_DREAMSAVE_FILE');
    if (file.version !== SNAPSHOT_VERSION) {
        warnings.push(
            `Save format v${file.version} loaded into engine v${SNAPSHOT_VERSION}.`,
        );
    }

    const encrypted = base64ToBytes(file.payload);
    const plaintext = await decryptSave(encrypted);
    const snapshot = JSON.parse(new TextDecoder().decode(plaintext)) as Snapshot;

    const compiled = getCompiledScript();
    if (snapshot.source_hash && snapshot.source_hash !== compiled.source_hash) {
        warnings.push(
            `Scenario changed since save (source hash mismatch). ` +
            `Position may be off.`,
        );
    }

    const env = deserializeEnv(snapshot.runtime_env);

    // Build the session at the start of the compiled script. The
    // cursor is set to 0, then replayTo walks forward to the saved
    // position, accumulating audio and image commands.
    const session: Session = {
        compiled,
        cursor: 0,
        return_stack: [],
        runtime_env: env,
        choices: [...(snapshot.choices ?? [])],
        _pending_audio: [],
        _pending_images: [],
        last_request_time: Date.now(),
        last_choice_time: 0,
    };

    const target = snapshot.cursor;
    const replay = await replayTo(session, target);

    if (replay.warnings.length > 0) warnings.push(...replay.warnings);

    // Restore the stack from the snapshot after replayTo, because
    // replayTo rebuilds its own stack along the way. The snapshot's
    // stack reflects the state at the moment of saving, which is
    // what the runtime should have on resume.
    session.return_stack = [...(snapshot.return_stack ?? [])];
    session.cursor = target;

    const sessionId = createSession(session);

    return {
        sessionId,
        metadata: file.metadata,
        variables: env,
        replay: {
            audio: replay.audio,
            images: replay.images,
            firstFrame: replay.firstFrame,
        },
        warnings,
    };
}

function bytesToBase64(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}