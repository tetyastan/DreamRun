import { BaseTag, TagParseResult } from './base.js';
import type { ParseContext, ScopeFrame } from '../types.js';

/**
 * Handles [ref name] ... [/ref].
 */
export class RefTag extends BaseTag {
    name = 'ref';
    private readonly OPEN = /^\[ref\s+([A-Za-z_][A-Za-z0-9_]*)\]$/;
    private readonly CLOSE = /^\[\/ref\]$/;

    parse(line: string, lineIdx: number, ctx: ParseContext): TagParseResult {
        const m = this.OPEN.exec(line);
        if (m) {
            for (const s of ctx.scope_stack) {
                if (s.type === 'ref') {
                    throw new Error(
                        `Syntax Error line ${lineIdx + 1}: ` +
                        `Nested [ref] blocks are strictly forbidden.`
                    );
                }
            }
            return new TagParseResult({
                consumed: true,
                scope_open: { type: 'ref', name: m[1].trim(), steps: [] },
            });
        }

        if (this.CLOSE.test(line)) {
            return new TagParseResult({ consumed: true, scope_close: 'ref' });
        }

        return new TagParseResult({ consumed: false });
    }
}

/**
 * Handles [choice] ... [/choice].
 */
export class ChoiceTag extends BaseTag {
    name = 'choice';
    private readonly OPEN = /^\[choice\]$/;
    private readonly CLOSE = /^\[\/choice\]$/;

    parse(line: string, lineIdx: number, ctx: ParseContext): TagParseResult {
        if (this.OPEN.test(line)) {
            const top = ctx.scope_stack[ctx.scope_stack.length - 1];
            if (top && top.type === 'ref') {
                throw new Error(
                    `Syntax Error line ${lineIdx + 1}: ` +
                    `[choice] cannot be nested inside a reference block.`
                );
            }
            return new TagParseResult({
                consumed: true,
                scope_open: { type: 'choice', answers: [] },
            });
        }

        if (this.CLOSE.test(line)) {
            const top = ctx.scope_stack[ctx.scope_stack.length - 1];
            if (!top || top.type !== 'choice') {
                throw new Error(`Syntax Error line ${lineIdx + 1}: Mismatched [/choice].`);
            }
            return new TagParseResult({ consumed: true, scope_close: 'choice' });
        }

        return new TagParseResult({ consumed: false });
    }
}

/**
 * Handles [answer "text"] ... [/answer].
 */
export class AnswerTag extends BaseTag {
    name = 'answer';
    private readonly OPEN = /^\[answer\s+"([^"]+)"\]$/;
    private readonly CLOSE = /^\[\/answer\]$/;

    parse(line: string, lineIdx: number, ctx: ParseContext): TagParseResult {
        const m = this.OPEN.exec(line);
        if (m) {
            const top = ctx.scope_stack[ctx.scope_stack.length - 1];
            if (!top || top.type !== 'choice') {
                throw new Error(
                    `Syntax Error line ${lineIdx + 1}: ` +
                    `[answer] requires an open [choice] parent block.`
                );
            }
            return new TagParseResult({
                consumed: true,
                scope_open: {
                    type: 'answer_paired',
                    text: m[1].trim(),
                    children: [],
                },
            });
        }

        if (this.CLOSE.test(line)) {
            const top = ctx.scope_stack[ctx.scope_stack.length - 1];
            if (!top || top.type !== 'answer_paired') {
                throw new Error(`Syntax Error line ${lineIdx + 1}: Mismatched [/answer].`);
            }
            return new TagParseResult({ consumed: true, scope_close: 'answer_paired' });
        }

        return new TagParseResult({ consumed: false });
    }
}