/**
 * Runtime data models shared by both [python] and [ts] execution.
 *
 * `Character` is a plain JS object. Python interacts with it through
 * a PyProxy, so reads and writes of its fields propagate between
 * languages without any explicit conversion.
 */
export class Character {
    name: string;
    [key: string]: unknown;

    constructor(name: string, attrs: Record<string, unknown> = {}) {
        this.name = name;
        for (const [k, v] of Object.entries(attrs)) {
            this[k] = v;
        }

        // Wrap the instance in a Proxy so that reading an undefined
        // field returns null instead of undefined. This mirrors the
        // Python __getattr__ fallback from the original engine and
        // keeps templates like {hero.level} from crashing.
        return new Proxy(this, {
            get(target, prop, receiver) {
                if (prop in target) {
                    return Reflect.get(target, prop, receiver);
                }
                if (typeof prop === 'symbol') {
                    return undefined;
                }
                return null;
            },
        });
    }
}

/**
 * Numeric proxy that carries an animation duration.
 *
 * Behaves like a number in arithmetic and comparisons. When passed to
 * the evaluator, it serializes to { from?, to, duration_ms }.
 */
export class Ramp {
    to_value: number;
    duration_ms: number;
    from_value: number | null;

    constructor(to: number, duration: number, from: number | null = null) {
        this.to_value = to;
        this.duration_ms = duration;
        this.from_value = from;
    }

    /**
     * Wire format consumed by the client. `from` is omitted when the
     * ramp should start from the current value on the client side.
     */
    serialize(): Record<string, unknown> {
        const out: Record<string, unknown> = {
            to: this.to_value,
            duration_ms: this.duration_ms,
        };
        if (this.from_value !== null) out.from = this.from_value;
        return out;
    }

    valueOf(): number { return this.to_value; }
    toString(): string { return String(this.to_value); }
}