import { json } from '@sveltejs/kit';
import { EngineError } from './errors.ts';
import { ScriptRuntimeError } from './script_runtime.ts';

/**
 * Converts any thrown value into a JSON HTTP response with the
 * consistent shape the client expects:
 *
 *     { detail: { status, message, details } }
 *
 * Order of matching matters:
 *   1. EngineError  — carries its own HTTP status and structured body.
 *   2. ScriptRuntimeError — comes from [ts] or [python] execution.
 *   3. Generic Error — unexpected failure, returned as 500.
 *   4. Anything else — unknown value, returned as 500.
 */
export function toErrorResponse(err: unknown): Response {
    if (err instanceof EngineError) {
        const { status, body } = err.toResponse();
        return json(body, { status });
    }

    if (err instanceof ScriptRuntimeError) {
        return json({
            detail: {
                status: `SCRIPT_${err.lang.toUpperCase()}_ERROR`,
                message: `${err.lang} block failed.`,
                details: String(err.cause),
            },
        }, { status: 422 });
    }

    if (err instanceof Error) {
        return json({
            detail: {
                status: 'RUNTIME_ERROR',
                message: err.message || 'Execution failed.',
                details: err.stack || 'None',
            },
        }, { status: 500 });
    }

    return json({
        detail: {
            status: 'UNKNOWN_ERROR',
            message: 'An unknown error occurred.',
            details: String(err),
        },
    }, { status: 500 });
}

/**
 * Wraps an async route handler so that any thrown value becomes a
 * structured JSON error response instead of a bare 500.
 *
 * The full error is logged to the server console before being
 * converted, so the operator can see the original stack trace even
 * when the client only receives a summarised message.
 */
export async function runSafely(
    handler: () => Promise<Response>
): Promise<Response> {
    try {
        return await handler();
    } catch (err) {
        console.error('[DreamRun][error]', err);
        return toErrorResponse(err);
    }
}