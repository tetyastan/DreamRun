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
 * The only difference is the `lang` field on the produced step and
 * the matching open/close tag names.
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
        // Inside a script block of a different language, defer.
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

    execute(_step: Step, _ctx: ExecContext): ExecResult {
        // Script execution is asynchronous. The runtime awaits it
        // separately via executeScriptStep below.
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
 * Called by the runtime for every `script_exec` step. Routes the code
 * to the correct interpreter.
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