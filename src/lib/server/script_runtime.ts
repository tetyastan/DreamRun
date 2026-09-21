import type { ExecContext } from './types.js';
import { getPyodide } from './pyodide_runtime.js';

/**
 * Raised when scenario code fails. Carries the original exception so
 * that the runtime can build a diagnostic HTTP response.
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

/**
 * Dispatches a script block to the correct runtime. Both [ts] and
 * [python] blocks produce a `script_exec` step with a `lang` field,
 * so this is the single entry point for scenario code execution.
 */
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

/**
 * Runs a [ts] block.
 *
 * The code is wrapped in a `with (env)` statement so that reads and
 * writes of top-level variables like `hero` or `flags` resolve against
 * the runtime environment. `ctx` and `env` are also passed as function
 * parameters so that shadowed names still work.
 */
function runTs(code: string, ctx: ExecContext): void {
    try {
        const runner = new Function('ctx', 'env', `
            with (env) {
                ${code}
            }
        `);
        runner(ctx, ctx.env);
    } catch (err) {
        throw new ScriptRuntimeError('ts', code, err);
    }
}

// ---------------------------------------------------------------------
// Python execution
// ---------------------------------------------------------------------

// Serializes calls into Pyodide. Pyodide is not reentrant, so concurrent
// requests must wait for each other.
let pyodideLock: Promise<void> = Promise.resolve();

/**
 * Runs a [python] block.
 *
 * The session env is passed into Python as a PyProxy, so attribute
 * reads and writes propagate between the two languages. After the
 * block finishes, syncPythonToJs copies any top-level scalar
 * reassignments back into the JS env.
 *
 * The lock around pyodideLock guarantees that only one Python block
 * executes at a time.
 */
async function runPython(code: string, ctx: ExecContext): Promise<void> {
    const currentLock = pyodideLock;
    let resolveLock: () => void;
    pyodideLock = new Promise(r => { resolveLock = r; });
    await currentLock;

    const py = await getPyodide();
    let envProxy: any = null;
    
    try {
        envProxy = py.toPy(ctx.env);
        py.runPython(code, { globals: envProxy });
        syncPythonToJs(envProxy, ctx.env);
    } catch (err) {
        throw new ScriptRuntimeError('python', code, err);
    } finally {
        if (envProxy && typeof envProxy.destroy === 'function') {
            envProxy.destroy();
        }
        resolveLock!();
    }
}

/**
 * Copies top-level scalars from the Python proxy back into the JS
 * env. Nested object mutations are already visible because the proxy
 * wraps the live JS object, but a statement like `flags = []` inside
 * Python replaces the binding and must be mirrored explicitly.
 */
function syncPythonToJs(pyEnv: any, jsEnv: Record<string, unknown>): void {
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
    return value;
}