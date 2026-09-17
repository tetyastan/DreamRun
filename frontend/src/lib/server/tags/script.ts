import { BaseTag, TagParseResult, type ExecResult } from './base.js';
import type { Step, ExecContext, ParseContext } from '../types.js';
import { dedent } from '../text_utils.js';
import { runScript, ScriptRuntimeError } from '../script_runtime.js';

/**
 * Shared implementation for [python] and [ts].
 *
 * Both tags parse the same three syntactic forms:
 *     [tag] … [/tag]       multi-line block
 *     [tag "code"/]        inline single-line
 *
 * The only difference is the `lang` field on the produced step and the
 * matching opening/closing tags.
 *
 * Multi-line accumulation is handled by the parser (see parser.ts).
 * When this tag sees the closing tag, it reads the accumulated lines
 * from ctx.script_accumulator and emits the step.
 */
abstract class ScriptTagBase extends BaseTag {
    abstract lang: 'python' | 'ts';
    abstract openTag: string;
    abstract closeTag: string;

    private get OPEN(): RegExp {
        return new RegExp(`^\\[${this.openTag}\\]\\s*$`);
    }

    private get CLOSE(): RegExp {
        return new RegExp(`^\\[/${this.openTag}\\]\\s*$`);
    }

    private get INLINE(): RegExp {
        return new RegExp(`^\\[${this.openTag}\\s+"(.*)"\\s*/?\\]$`);
    }

    parse(line: string, _lineIdx: number, ctx: ParseContext): TagParseResult {
        // If we are inside a script block of a different language,
        // defer to the next tag.
        if (ctx.in_script_block && ctx.script_lang !== this.lang) {
            return new TagParseResult({ consumed: false });
        }

        if (this.OPEN.test(line)) {
            ctx.in_script_block = true;
            ctx.script_lang = this.lang;
            ctx.script_accumulator = [];
            return new TagParseResult({ consumed: true });
        }

        if (this.CLOSE.test(line)) {
            ctx.in_script_block = false;
            ctx.script_lang = null;
            const raw = ctx.script_accumulator.join('\n');
            const code = dedent(raw);
            ctx.script_accumulator = [];
            return new TagParseResult({
                step: { type: 'script_exec', lang: this.lang, code },
                consumed: true,
            });
        }

        const m = this.INLINE.exec(line);
        if (m) {
            return new TagParseResult({
                step: { type: 'script_exec', lang: this.lang, code: m[1] },
                consumed: true,
            });
        }

        return new TagParseResult({ consumed: false });
    }

    execute(step: Step, ctx: ExecContext): ExecResult {
        if (step.type !== 'script_exec') return null;
        if (step.lang !== this.lang) return null;

        // The runtime awaits executeScript asynchronously; see runtime.ts.
        // Here we only signal that this tag owns the step. The actual
        // execution happens in the dispatch layer.
        void ctx;
        return null;
    }
}

export class PythonTag extends ScriptTagBase {
    name = 'python';
    lang = 'python' as const;
    openTag = 'python';
    closeTag = '/python';
}

export class TsTag extends ScriptTagBase {
    name = 'ts';
    lang = 'ts' as const;
    openTag = 'ts';
    closeTag = '/ts';
}

/**
 * Async dispatch hook invoked by the runtime when a `script_exec` step
 * is encountered. Both [python] and [ts] route through this function.
 *
 * The tag class itself cannot run async work in `execute` because the
 * tag dispatch loop is synchronous. Exposing this separate async
 * function keeps the tag interface simple.
 */
export async function executeScriptStep(step: Step, ctx: ExecContext): Promise<void> {
    if (step.type !== 'script_exec') return;
    const lang = step.lang;
    if (lang !== 'python' && lang !== 'ts') {
        throw new Error(`Unknown script language: ${String(lang)}`);
    }
    await runScript(lang, step.code as string, ctx);
}

export { ScriptRuntimeError };