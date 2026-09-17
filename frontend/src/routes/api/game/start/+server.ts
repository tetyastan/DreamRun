import { json } from '@sveltejs/kit';
import path from 'node:path';
import { parseDreamrunBlocks } from '$lib/server/parser.js';
import { executeRuntime } from '$lib/server/runtime.js';
import { SESSIONS, createSession } from '$lib/server/sessions.js';
import { Character, Ramp } from '$lib/server/runtime_types.js';
import { SCENES_DIR, INDEX_ACT } from '$lib/server/config.js';
import { loadDefaultVars } from '$lib/server/config_loader.js';
import { ScriptRuntimeError } from '$lib/server/script_runtime.js';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = async () => {
    const firstAct = path.join(SCENES_DIR, INDEX_ACT);

    let data;
    try {
        data = parseDreamrunBlocks(firstAct);
    } catch (err) {
        return json({
            detail: {
                status: 'SYNTAX_COMPILATION_ERROR',
                message: 'Scenario file contains syntax errors.',
                details: String(err),
            },
        }, { status: 400 });
    }

    if (!data) {
        return json({
            detail: {
                status: 'ACT_MISSING_ERROR',
                message: `Entry file '${INDEX_ACT}' missing.`,
            },
        }, { status: 404 });
    }

    const sessionId = createSession({
        current_act: firstAct,
        cached_steps: data.steps,
        step_index: 0,
        runtime_env: { Character, Ramp },
        references: data.references,
        return_stack: [],
        last_request_time: 0,
        last_choice_time: 0,
        _pending_audio: [],
        _pending_images: [],
    });

    try {
        const session = SESSIONS.get(sessionId)!;
        await loadDefaultVars(session);
    } catch (err) {
        SESSIONS.delete(sessionId);
        return json({
            detail: {
                status: 'CORE_CONFIG_PARSE_ERROR',
                message: 'Baseline config error.',
                details: String(err),
            },
        }, { status: 500 });
    }

    try {
        const result = await executeRuntime(sessionId);
        const session = SESSIONS.get(sessionId)!;
        return json({
            session_id: sessionId,
            steps: result.steps,
            variables: publicVariables(session),
        });
    } catch (err) {
        SESSIONS.delete(sessionId);
        return scriptErrorResponse(err);
    }
};

function publicVariables(session: any): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(session.runtime_env)) {
        if (k === 'Character' || k === 'Ramp') continue;
        if (typeof v === 'function') continue;
        out[k] = v;
    }
    return out;
}

function scriptErrorResponse(err: unknown) {
    if (err instanceof ScriptRuntimeError) {
        return json({
            detail: {
                status: `SCRIPT_${err.lang.toUpperCase()}_ERROR`,
                message: `${err.lang} block failed.`,
                details: `${String(err.cause)}`,
            },
        }, { status: 422 });
    }
    return json({
        detail: {
            status: 'RUNTIME_ERROR',
            message: 'Execution failed.',
            details: String(err),
        },
    }, { status: 500 });
}