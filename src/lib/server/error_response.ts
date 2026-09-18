import { json } from '@sveltejs/kit';
import { EngineError } from './errors.ts';
import { ScriptRuntimeError } from './script_runtime.ts';

/**
 * Converts any thrown value into a JSON HTTP response with the
 * consistent shape the client expects:
 *
 *     { detail: { status, message, details } }
 *
 * Order of matching matters: EngineError and ScriptRuntimeError first,
 * then a generic Error, then anything else.
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
 */
export async function runSafely(
    handler: () => Promise<Response>
): Promise<Response> {
    try {
        return await handler();
    } catch (err) {
        // Log full error to the server console for debugging.
        console.error('[DreamRun][error]', err);
        return toErrorResponse(err);
    }
}