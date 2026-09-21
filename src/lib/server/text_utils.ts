// Full animation form: "[FROM]..[TO] : MILLIS"
export const ANIMATION_PATTERN =
    /^\s*(?<from>-?\d+(?:\.\d+)?)?\.\.(?<to>-?\d+(?:\.\d+)?)?\s*:\s*(?<duration>\d+)\s*$/;

// Short animation form: "VALUE~MILLIS"
export const ANIMATION_SHORT_PATTERN =
    /^\s*(?<to>-?\d+(?:\.\d+)?)\s*~\s*(?<duration>\d+)\s*$/;

export type Animation = { from: number; to: number; duration_ms: number };

/**
 * Parses a numeric argument that may carry an animation descriptor.
 *
 * Returns one of:
 *   - a plain number, if the argument is a literal
 *   - { from, to, duration_ms }, if it is an animation
 *   - null, if the argument does not match any known form
 *
 * `defaultFrom` is used when the animation omits the left side:
 *   - [audio sound/music] passes 0.0 so fade-in starts from silence.
 *   - [audio modify] passes null so the client resolves "from" itself.
 */
export function parseAnimatedValue(
    raw: string,
    defaultFrom: number | null = null
): number | Animation | null {
    const s = raw.trim();

    // Plain literal has priority over any pattern match.
    if (s !== '') {
        const asFloat = Number(s);
        if (!Number.isNaN(asFloat)) return asFloat;
    }

    const short = ANIMATION_SHORT_PATTERN.exec(s);
    if (short?.groups) {
        return {
            from: defaultFrom,
            to: Number.parseFloat(short.groups.to),
            duration_ms: Number.parseInt(short.groups.duration, 10),
        };
    }

    const full = ANIMATION_PATTERN.exec(s);
    if (full?.groups) {
        return {
            from: full.groups.from
                ? Number.parseFloat(full.groups.from)
                : defaultFrom,
            to: full.groups.to
                ? Number.parseFloat(full.groups.to)
                : (defaultFrom ?? 0),
            duration_ms: Number.parseInt(full.groups.duration, 10),
        };
    }

    return null;
}

/**
 * Strips a matching pair of outer quotes from a dialogue line. Used
 * only when REMOVE_QUOTATION_MARKS is true.
 */
export function cleanDialogueText(text: string): string {
    const stripped = text.trim();
    if (
        (stripped.startsWith('"') && stripped.endsWith('"')) ||
        (stripped.startsWith("'") && stripped.endsWith("'"))
    ) {
        return stripped.slice(1, -1).trim();
    }
    return stripped;
}

/**
 * Removes the common leading whitespace from every non-empty line.
 *
 * Used for multi-line [python] and [ts] blocks, so that authors can
 * indent their code inside the .dreamrun file without the runtime
 * passing those indents to the interpreter.
 *
 * If the common indent is zero, or if all lines are empty, the string
 * is returned unchanged.
 */
export function dedent(str: string): string {
    const lines = str.split('\n');
    const nonEmpty = lines.filter(l => l.trim().length > 0);
    if (nonEmpty.length === 0) return str;

    let minIndent = Infinity;
    for (const l of nonEmpty) {
        const m = l.match(/^(\s*)/);
        const indent = m ? m[1].length : 0;
        if (indent < minIndent) minIndent = indent;
    }
    if (minIndent === 0 || !Number.isFinite(minIndent)) return str;

    return lines.map(l => l.slice(minIndent)).join('\n');
}