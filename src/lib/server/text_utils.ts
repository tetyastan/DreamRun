export const ANIMATION_PATTERN =
    /^\s*(?<from>-?\d+(?:\.\d+)?)?\.\.(?<to>-?\d+(?:\.\d+)?)?\s*:\s*(?<duration>\d+)\s*$/;

export const ANIMATION_SHORT_PATTERN =
    /^\s*(?<to>-?\d+(?:\.\d+)?)\s*~\s*(?<duration>\d+)\s*$/;

export type Animation = { from: number; to: number; duration_ms: number };

export function parseAnimatedValue(
    raw: string,
    defaultFrom: number | null = null
): number | Animation | null {
    const s = raw.trim();

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