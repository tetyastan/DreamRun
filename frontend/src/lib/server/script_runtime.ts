import type { ExecContext } from './types.js';
import { getPyodide } from './pyodide_runtime.js';

/**
 * Raised when scenario code fails. Carries the original exception so
 * the runtime can build a diagnostic HTTP response.
 */
export class ScriptRuntimeError extends Error {
    lang: 'python' | 'ts';
    code: string;
    cause: unknown;

    constructor(lang: 'python' | 'ts', code: string, cause: unknown) {
        super(`${lang} execution failed`);
        this.name = 'ScriptRuntimeError';
        this.lang = lang;
        this.code = code;
        this.cause = cause;
    }
}

export async function runScript(
    lang: 'python' | 'ts',
    code: string,
    ctx: ExecContext
): Promise<void> {
    if (lang === 'ts') return runTs(code, ctx);
    if (lang === 'python') return runPython(code, ctx);
    throw new Error(`Unsupported script language: ${lang}`);
}

// ---------------------------------------------------------------------
// TypeScript execution
// ---------------------------------------------------------------------

function runTs(code: string, ctx: ExecContext): void {
    try {
        const env = ctx.env;
        // Filter env keys that are valid JS identifiers.
        const keys = Object.keys(env).filter(k => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k));
        const values = keys.map(k => env[k]);

        // The function body is the scenario code. Env keys are passed
        // as parameters so that:
        //   - reads of `hero`, `Ramp`, etc. work directly
        //   - mutations like `hero.hp = 100` persist (hero is an object)
        //   - top-level scalar assignments do NOT persist, because JS
        //     function parameters are local bindings.
        //
        // Scenario authors who need top-level persistence should mutate
        // an object (`state.counter += 1`) or use [python].
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const fn = new Function('ctx', 'env', ...keys, code);
        fn(ctx, env, ...values);
    } catch (err) {
        throw new ScriptRuntimeError('ts', code, err);
    }
}

// ---------------------------------------------------------------------
// Python execution
// ---------------------------------------------------------------------

async function runPython(code: string, ctx: ExecContext): Promise<void> {
    const py = await getPyodide();

    let envProxy: any = null;
    try {
        // toPy creates a PyProxy wrapping the JS object. Reads and writes
        // of attributes delegate to JS. New top-level keys become new
        // properties on the JS object.
        envProxy = py.toPy(ctx.env);

        // Execute the scenario code with env as the global namespace.
        py.runPython(code, { globals: envProxy });

        // PyProxy changes propagate automatically for nested objects.
        // For top-level scalar writes we copy values back explicitly.
        syncPythonToJs(envProxy, ctx.env);
    } catch (err) {
        throw new ScriptRuntimeError('python', code, err);
    } finally {
        if (envProxy && typeof envProxy.destroy === 'function') {
            // Do NOT destroy: env is reused across requests and the
            // proxy wraps the live JS object. Destroying would break
            // subsequent Python runs.
            // envProxy.destroy();
        }
    }
}

function syncPythonToJs(pyEnv: any, jsEnv: Record<string, unknown>): void {
    // Copy top-level scalar values that may have been reassigned inside
    // the Python block. Nested object mutations are already live.
    try {
        const keys: string[] = Array.from(pyEnv.keys());
        for (const key of keys) {
            const pyValue = pyEnv.get(key);
            jsEnv[key] = unwrapPyValue(pyValue);
        }
    } catch {
        // Some PyProxy variants do not support .keys()/.get(). Fallback
        // to copying only keys already present in jsEnv.
        for (const key of Object.keys(jsEnv)) {
            try {
                jsEnv[key] = unwrapPyValue(pyEnv.get(key));
            } catch {
                // ignore
            }
        }
    }
}

function unwrapPyValue(value: unknown): unknown {
    // Pyodide returns PyProxy for objects and plain JS values for
    // primitives. We return as-is; the evaluator handles Ramp and
    // Character via duck typing.
    return value;
}