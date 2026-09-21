import { Character, Ramp } from './runtime_types.js';

// Markers used to distinguish engine-owned classes from plain
// objects during round-tripping. They are stripped on deserialize.
const CHAR_MARK = '__character__';
const RAMP_MARK = '__ramp__';

/**
 * Converts the runtime env into a plain JSON-safe structure.
 *
 * Keys beginning with "__" are treated as metadata and skipped, with
 * the single exception of "__savestamp__": that key is intentionally
 * preserved so that authors can read it back in the SaveMenu.
 *
 * Engine-owned classes (Character and Ramp) are tagged with a marker
 * field and their own fields are serialized recursively. Instances
 * of Character are detected with instanceof, which is the only
 * reliable signal — arbitrary user keys cannot be trusted as type
 * discriminators.
 */
export function serializeEnv(env: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(env)) {
        if (k === 'Character' || k === 'Ramp') continue;
        if (k.startsWith('__') && k !== '__savestamp__') continue;
        if (typeof v === 'function') continue;
        out[k] = serializeValue(v);
    }
    return out;
}

function serializeValue(v: unknown): unknown {
    if (v === null || v === undefined) return v;

    if (v instanceof Character) {
        const obj: Record<string, unknown> = {
            [CHAR_MARK]: true,
            name: v.name,
        };
        for (const [k, val] of Object.entries(v)) {
            if (k === 'name') continue;
            obj[k] = serializeValue(val);
        }
        return obj;
    }

    if (v instanceof Ramp) {
        return {
            [RAMP_MARK]: true,
            to_value: v.to_value,
            duration_ms: v.duration_ms,
            from_value: v.from_value,
        };
    }

    if (Array.isArray(v)) return v.map(serializeValue);

    if (typeof v === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(v as object)) {
            out[k] = serializeValue(val);
        }
        return out;
    }

    return v;
}

/**
 * Rebuilds a runtime env from its serialized form.
 *
 * The engine-owned Character and Ramp classes are re-injected so
 * that scenario code can still construct them after a load, and so
 * that instanceof checks inside the runtime keep working.
 */
export function deserializeEnv(data: Record<string, unknown>): Record<string, unknown> {
    const env: Record<string, unknown> = { Character, Ramp };
    for (const [k, v] of Object.entries(data)) {
        env[k] = deserializeValue(v);
    }
    return env;
}

function deserializeValue(v: unknown): unknown {
    if (v === null || v === undefined) return v;
    if (Array.isArray(v)) return v.map(deserializeValue);

    if (typeof v === 'object') {
        const obj = v as Record<string, unknown>;

        if (obj[CHAR_MARK]) {
            const { [CHAR_MARK]: _m, name, ...attrs } = obj;
            const cleanAttrs: Record<string, unknown> = {};
            for (const [k, val] of Object.entries(attrs)) {
                cleanAttrs[k] = deserializeValue(val);
            }
            return new Character(name as string, cleanAttrs);
        }

        if (obj[RAMP_MARK]) {
            return new Ramp(
                obj.to_value as number,
                obj.duration_ms as number,
                (obj.from_value as number | null) ?? null,
            );
        }

        const out: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(obj)) {
            out[k] = deserializeValue(val);
        }
        return out;
    }

    return v;
}