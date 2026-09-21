/**
 * Extracts the client-visible subset of the runtime environment.
 *
 * Hides:
 *   - the Character and Ramp classes
 *   - any private key starting with "__"
 *   - any function value
 *
 * Used by every route that returns `variables` in its response.
 */
export function getPublicVariables(env: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(env)) {
        if (k === 'Character' || k === 'Ramp') continue;
        if (k.startsWith('__')) continue;
        if (typeof v === 'function') continue;
        out[k] = v;
    }
    return out;
}