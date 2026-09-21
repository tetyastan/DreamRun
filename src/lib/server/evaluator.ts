import type { Step } from './types.js';

// Matches a single placeholder: "{hero.money}" or "{hero}"
const EXPLICIT_EXPR_PATTERN =
    /^\{(?<expr>[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\}$/;

// Matches any {...} inside a larger string, for inline interpolation.
const INLINE_BRACKETS_PATTERN = /\{([^}]+)\}/g;

/**
 * Recursively walks a compiled step and resolves every `{...}` string
 * against `env`. Returns a new value; the input is not mutated.
 *
 * Two cases are handled:
 *
 *   - A string that is exactly "{...}" is evaluated as a JS expression
 *     and the result is returned as-is. If the result is a Ramp, its
 *     serialized payload is returned instead.
 *   - A string containing {...} somewhere inside is treated as a
 *     template and every placeholder is replaced with its stringified
 *     value.
 *
 * Failures are non-fatal: an unresolved placeholder becomes
 * "UNRESOLVED_EXPR:..." or "{UNRESOLVED:...}" so the author can see
 * exactly which expression failed.
 */
export function evaluateStepParameters(
    node: unknown,
    environment: Record<string, unknown>
): unknown {
    if (Array.isArray(node)) {
        return node.map(v => evaluateStepParameters(v, environment));
    }

    if (node !== null && typeof node === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(node)) {
            out[k] = evaluateStepParameters(v, environment);
        }
        return out;
    }

    if (typeof node !== 'string') return node;

    const stripped = node.trim();

    // Standalone placeholder: replace the whole field with the value.
    const standalone = EXPLICIT_EXPR_PATTERN.exec(stripped);
    if (standalone?.groups) {
        const expr = standalone.groups.expr;
        try {
            const value = evalExpression(expr, environment);
            if (
                value &&
                typeof value === 'object' &&
                typeof (value as any).serialize === 'function'
            ) {
                return (value as any).serialize();
            }
            return value;
        } catch {
            return `UNRESOLVED_EXPR:${expr}`;
        }
    }

    // Inline interpolation: substitute each placeholder inside the string.
    if (node.includes('{') && node.includes('}')) {
        return node.replace(INLINE_BRACKETS_PATTERN, (_m, expr: string) => {
            try {
                const res = evalExpression(expr, environment);
                if (res && typeof res === 'object' && 'to_value' in res) {
                    return String((res as any).to_value);
                }
                return String(res);
            } catch {
                return `{UNRESOLVED:${expr}}`;
            }
        });
    }

    return node;
}

/**
 * Evaluates a single JS expression with `environment` keys as its
 * local scope.
 *
 * `new Function` is used rather than `eval` so that the global scope
 * is not visible inside the expression. The trust model is the same
 * as the previous Python `eval`: only trusted scenario authors should
 * be able to write .dreamrun files.
 */
function evalExpression(expr: string, environment: Record<string, unknown>): unknown {
    const keys = Object.keys(environment).filter(k =>
        /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k)
    );
    const values = keys.map(k => environment[k]);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(...keys, `return (${expr});`);
    return fn(...values);
}