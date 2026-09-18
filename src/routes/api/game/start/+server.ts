import { json } from '@sveltejs/kit';
import path from 'node:path';
import { parseDreamrunBlocks } from '$lib/server/parser.js';
import { executeRuntime } from '$lib/server/runtime.js';
import { SESSIONS, createSession } from '$lib/server/sessions.js';
import { Character, Ramp } from '$lib/server/runtime_types.js';
import { SCENES_DIR, INDEX_ACT } from '$lib/server/config.js';
import { loadDefaultVars } from '$lib/server/config_loader.js';
import { runSafely } from '$lib/server/error_response.js';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = async () => {
    return runSafely(async () => {
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
                    details: `Expected path: ${firstAct}`,
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

        const result = await executeRuntime(sessionId);
        const session = SESSIONS.get(sessionId)!;

        return json({
            session_id: sessionId,
            steps: result.steps,
            variables: publicVariables(session),
        });
    });
};

function publicVariables(session: any): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(session.runtime_env)) {
        if (k === 'Character' || k === 'Ramp') continue;
        if (k.startsWith('__')) continue;
        if (typeof v === 'function') continue;
        out[k] = v;
    }
    return out;
}