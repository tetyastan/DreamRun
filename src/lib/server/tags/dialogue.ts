import { BaseTag, TagParseResult, type ExecResult } from './base.js';
import type { Step, ExecContext, ParseContext, Frame } from '../types.js';
import { cleanDialogueText } from '../text_utils.js';
import { Character } from '../runtime_types.js';

/**
 * Builds the final dialogue frame, resolving {name} and {obj.field}
 * placeholders against the runtime env. Animated forms ({0..500 : 2000})
 * are left in the text and resolved by the client.
 */
function buildFrame(step: Step, name: string | null, ctx: ExecContext): Frame {
    const raw = step.raw_text as string;
    let resolved = raw;

    if (resolved) {
        resolved = resolved.replace(
            /\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\}/g,
            (_match, expr: string) => {
                try {
                    const keys = Object.keys(ctx.env).filter(k =>
                        /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k)
                    );
                    const values = keys.map(k => ctx.env[k]);
                    // eslint-disable-next-line @typescript-eslint/no-implied-eval
                    const fn = new Function(...keys, `return (${expr});`);
                    const value = fn(...values);
                    if (typeof value === 'number' && Number.isInteger(value)) {
                        return String(value);
                    }
                    return String(value);
                } catch {
                    return `{${expr}}`;
                }
            }
        );
    }

    return {
        type: 'dialogue',
        name,
        text: resolved,
    };
}

export class VariableSpeakerTag extends BaseTag {
    name = 'dialogue.variable';
    private readonly PATTERN = /^:([A-Za-z_][A-Za-z0-9_]*):\s*>\s*(.*)$/;

    parse(line: string, _lineIdx: number, _ctx: ParseContext): TagParseResult {
        const m = this.PATTERN.exec(line);
        if (!m) return new TagParseResult({ consumed: false });
        return new TagParseResult({
            step: {
                type: 'dialogue',
                speaker_mode: 'variable',
                key: m[1],
                raw_text: cleanDialogueText(m[2]),
            },
            consumed: true,
        });
    }

    execute(step: Step, ctx: ExecContext): ExecResult {
        if (step.type !== 'dialogue' || step.speaker_mode !== 'variable') return null;
        const key = step.key as string;
        const obj = ctx.env[key];
        const name = obj instanceof Character ? obj.name : key;
        return ['frame', buildFrame(step, name, ctx)];
    }
}

export class LiteralSpeakerTag extends BaseTag {
    name = 'dialogue.literal';
    private readonly PATTERN = /^([^>]+)>\s*(.*)$/;

    parse(line: string, _lineIdx: number, _ctx: ParseContext): TagParseResult {
        if (line.startsWith('>')) return new TagParseResult({ consumed: false });
        const m = this.PATTERN.exec(line);
        if (!m) return new TagParseResult({ consumed: false });
        return new TagParseResult({
            step: {
                type: 'dialogue',
                speaker_mode: 'literal',
                name: m[1].trim(),
                raw_text: cleanDialogueText(m[2]),
            },
            consumed: true,
        });
    }

    execute(step: Step, ctx: ExecContext): ExecResult {
        if (step.type !== 'dialogue' || step.speaker_mode !== 'literal') return null;
        return ['frame', buildFrame(step, step.name as string, ctx)];
    }
}

export class NarratorTag extends BaseTag {
    name = 'dialogue.narrator';

    parse(line: string, _lineIdx: number, _ctx: ParseContext): TagParseResult {
        if (!line.startsWith('>')) return new TagParseResult({ consumed: false });
        return new TagParseResult({
            step: {
                type: 'dialogue',
                speaker_mode: 'narrator',
                raw_text: cleanDialogueText(line.slice(1).trim()),
            },
            consumed: true,
        });
    }

    execute(step: Step, ctx: ExecContext): ExecResult {
        if (step.type !== 'dialogue' || step.speaker_mode !== 'narrator') return null;
        return ['frame', buildFrame(step, null, ctx)];
    }
}