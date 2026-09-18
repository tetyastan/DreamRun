import { json } from '@sveltejs/kit';
import { SESSIONS } from '$lib/server/sessions.js';
import { executeRuntime } from '$lib/server/runtime.js';
import { runSafely } from '$lib/server/error_response.js';
import type { RequestHandler } from './$types.js';

const MINIMUM_CHOICE_DELAY = 0.1;

export const POST: RequestHandler = async ({ request }) => {
    return runSafely(async () => {
        const sessionId = request.headers.get('X-Session-ID');
        if (!sessionId || !SESSIONS.has(sessionId)) {
            return json({
                detail: {
                    status: 'UNAUTHORIZED_SESSION',
                    message: 'Session expired.',
                    details: 'None',
                },
            }, { status: 401 });
        }

        const body = await request.json().catch(() => ({}));
        const choiceIndex = Number(body.choice_index);
        if (!Number.isInteger(choiceIndex)) {
            return json({
                detail: {
                    status: 'INVALID_PAYLOAD',
                    message: 'choice_index must be an integer.',
                    details: `Received: ${JSON.stringify(body.choice_index)}`,
                },
            }, { status: 400 });
        }

        const session = SESSIONS.get(sessionId)!;
        const now = Date.now() / 1000;

        if (
            MINIMUM_CHOICE_DELAY > 0 &&
            session.last_choice_time > 0 &&
            now - session.last_choice_time < MINIMUM_CHOICE_DELAY
        ) {
            return json({
                detail: {
                    status: 'RATE_LIMIT_EXCEEDED',
                    message: 'Choice submissions are arriving too fast.',
                    details: 'None',
                },
            }, { status: 429 });
        }
        session.last_choice_time = now;
        session.last_request_time = now;

        if (session.step_index >= session.cached_steps.length) {
            return json({
                detail: {
                    status: 'INVALID_STATE',
                    message: 'No active choice found.',
                    details: `step_index=${session.step_index}, total=${session.cached_steps.length}`,
                },
            }, { status: 400 });
        }

        const node = session.cached_steps[session.step_index];
        if (node.type !== 'choice') {
            return json({
                detail: {
                    status: 'INVALID_STATE',
                    message: 'Pointer configuration mismatch.',
                    details: `Expected 'choice', got '${node.type}'`,
                },
            }, { status: 400 });
        }

        const options = node.options as Array<{ type: string; branches?: unknown[]; action?: unknown }>;
        if (choiceIndex < 0 || choiceIndex >= options.length) {
            return json({
                detail: {
                    status: 'OUT_OF_BOUNDS',
                    message: 'Selected choice out of scope.',
                    details: `index=${choiceIndex}, options=${options.length}`,
                },
            }, { status: 420 });
        }

        const chosen = options[choiceIndex];
        session.step_index += 1;

        if (chosen.type === 'paired' && Array.isArray(chosen.branches)) {
            for (let i = chosen.branches.length - 1; i >= 0; i--) {
                session.cached_steps.splice(session.step_index, 0, chosen.branches[i] as any);
            }
        } else if (chosen.type === 'self_closing' && chosen.action) {
            session.cached_steps.splice(session.step_index, 0, chosen.action as any);
        }

        const result = await executeRuntime(sessionId);

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