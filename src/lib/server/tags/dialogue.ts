import { BaseTag, TagParseResult, type ExecResult } from './base.js';
import type { Step, ExecContext, ParseContext, Frame } from '../types.js';
import { cleanDialogueText } from '../text_utils.js';
import { Character } from '../runtime_types.js';

/**
 * Builds the final dialogue frame for the client.
 *
 * Placeholders of the form {expr} are resolved against the runtime
 * env. Animated counters ({0..500 : 2000}, {..var : 1000}) are left
 * untouched so the client can animate them.
 *
 * Any placeholder that fails to resolve is left as-is so the author
 * sees exactly what did not compile.
 */
export function buildFrame(step: Step, name: string | null, ctx: ExecContext): Frame {
    const raw = step.raw_text as string;
    
    if (!raw) {
        return {
            type: 'dialogue',
            name,
            text: raw,
        };
    }

    let resolved = raw;

    try {
        // Convert {expr} to ${expr} and evaluate the result as a
        // template literal. Placeholders that start with a digit or
        // contain '..' or '~' are animation descriptors and are not
        // touched.
        const templateString = raw
            .replace(/`/g, '\\` electro_escape_backtick')
            .replace(/\{(?!\d+(?:\.\d+)?(?:\.\.|~))([^}]+)\}/g, '\${\$1}');

        const templateEvaluator = new Function('env', 'templateString', `
            with (env) {
                try {
                    return eval('\` ' + templateString + ' \`').slice(1, -1);
                } catch {
                    return null;
                }
            }
        `);

        const result = templateEvaluator(ctx.env, templateString);
        
        if (result !== null) {
            resolved = result;
        }
    } catch (err) {
        console.warn(`[DreamRun][dialogue] Template compilation failed for text: "${raw}"`, err);
    }

    return {
        type: 'dialogue',
        name,
        text: resolved,
    };
}

/**
 * Handles :var: > "text". The speaker name is taken from the Character
 * stored in env under `key`. If the value is not a Character, the raw
 * key is shown as a fallback.
 */
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

/**
 * Handles "Name > text". The speaker name is the literal string
 * before the > sign.
 */
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

/**
 * Handles "> text". No speaker name.
 */
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