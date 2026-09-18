import { json } from '@sveltejs/kit';
import { SESSIONS } from '$lib/server/sessions.js';
import { executeRuntime } from '$lib/server/runtime.js';
import { runSafely } from '$lib/server/error_response.js';
import type { RequestHandler } from './$types.js';

const MINIMUM_READ_TIME = 0.2;

export const POST: RequestHandler = async ({ request }) => {
    return runSafely(async () => {
        const sessionId = request.headers.get('X-Session-ID');
        if (!sessionId || !SESSIONS.has(sessionId)) {
            return json({
                detail: {
                    status: 'UNAUTHORIZED_SESSION',
                    message: 'Session context invalid or expired.',
                    details: 'None',
                },
            }, { status: 401 });
        }

        const session = SESSIONS.get(sessionId)!;
        const now = Date.now() / 1000;

        if (session.last_request_time > 0) {
            if (now - session.last_request_time < MINIMUM_READ_TIME) {
                return json({
                    detail: {
                        status: 'RATE_LIMIT_EXCEEDED',
                        message: 'Game state synchronization anomaly detected.',
                        details: 'None',
                    },
                }, { status: 429 });
            }
        }
        session.last_request_time = now;

        const result = await executeRuntime(sessionId);

        if (result.steps.length === 0) {
            return json({
                steps: [{ type: 'game_end' }],
                variables: publicVariables(session),
            });
        }

        return json({
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