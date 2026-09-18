import type { Step } from './types.js';

const EXPLICIT_EXPR_PATTERN =
    /^\{(?<expr>[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\}$/;

const INLINE_BRACKETS_PATTERN = /\{([^}]+)\}/g;

/**
 * Resolves every `{...}` in a compiled step against `env`.
 *
 * - Standalone forms `"{hero.money}"` are evaluated as JS expressions.
 *   If the result is a Ramp, it is serialized to a plain payload.
 * - Inline forms `"path/{name}.png"` are replaced with string values.
 *
 * The evaluator is intentionally language-agnostic. It reads the same
 * `env` object that both [python] and [ts] mutate.
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

    const standalone = EXPLICIT_EXPR_PATTERN.exec(stripped);
    if (standalone?.groups) {
        const expr = standalone.groups.expr;
        try {
            const value = evalExpression(expr, environment);
            if (value && typeof value === 'object' && typeof (value as any).serialize === 'function') {
                return (value as any).serialize();
            }
            return value;
        } catch {
            return `UNRESOLVED_EXPR:${expr}`;
        }
    }

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
 * Evaluates a single JS expression with `environment` keys as scope.
 * Uses `new Function` rather than `eval` to avoid touching the global
 * scope. Trust model is identical to the previous Python `eval`.
 */
function evalExpression(expr: string, environment: Record<string, unknown>): unknown {
    const keys = Object.keys(environment).filter(k => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k));
    const values = keys.map(k => environment[k]);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(...keys, `return (${expr});`);
    return fn(...values);
}