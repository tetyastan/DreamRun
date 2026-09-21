import { BaseTag, TagParseResult, type ExecResult } from './base.js';
import type { Step, ExecContext, ParseContext } from '../types.js';

/**
 * [pass/] — deliberate no-op.
 */
export class PassTag extends BaseTag {
    name = 'pass';
    private readonly PATTERN = /^\[pass\s*\/\]$/;

    parse(line: string, _lineIdx: number, _ctx: ParseContext): TagParseResult {
        if (!this.PATTERN.test(line)) {
            return new TagParseResult({ consumed: false });
        }
        return new TagParseResult({ step: { type: 'pass' }, consumed: true });
    }

    execute(step: Step, _ctx: ExecContext): ExecResult {
        if (step.type !== 'pass') return null;
        return null;
    }
}

/**
 * [next "file"/] — switch to another act file.
 *
 * The tag only emits a `change_act` step. The actual file loading
 * happens in the runtime, which owns the SCENES_DIR path and can
 * check that the file exists before swapping.
 */
export class NextTag extends BaseTag {
    name = 'next';
    private readonly PATTERN = /^\[next\s+(?:"([^"]+)"|(\{[A-Za-z0-9_.]+\}))\s*\/?\]$/;

    parse(line: string, _lineIdx: number, _ctx: ParseContext): TagParseResult {
        const m = this.PATTERN.exec(line);
        if (!m) return new TagParseResult({ consumed: false });
        return new TagParseResult({
            step: { type: 'change_act', next_act_path: (m[1] ?? m[2]).trim() },
            consumed: true,
        });
    }

    execute(step: Step, _ctx: ExecContext): ExecResult {
        if (step.type !== 'change_act') return null;
        return 'change_act';
    }
}

/**
 * [jump ref/] — subroutine call with a return frame.
 *
 * The runtime pushes the current position onto return_stack and swaps
 * cached_steps to the referenced block. When that block ends, control
 * returns to the saved frame.
 */
export class JumpTag extends BaseTag {
    name = 'jump';
    private readonly PATTERN = /^\[jump\s+([A-Za-z_][A-Za-z0-9_]*)\s*\/?\]$/;

    parse(line: string, _lineIdx: number, _ctx: ParseContext): TagParseResult {
        const m = this.PATTERN.exec(line);
        if (!m) return new TagParseResult({ consumed: false });
        return new TagParseResult({
            step: { type: 'jump', target: m[1].trim() },
            consumed: true,
        });
    }

    execute(step: Step, _ctx: ExecContext): ExecResult {
        if (step.type !== 'jump') return null;
        return 'jump';
    }
}

/**
 * [goto ref/] — unconditional jump. Same as jump but without a return
 * frame. Typically the target block ends with its own [next].
 */
export class GotoTag extends BaseTag {
    name = 'goto';
    private readonly PATTERN = /^\[goto\s+([A-Za-z_][A-Za-z0-9_]*)\s*\/?\]$/;

    parse(line: string, _lineIdx: number, _ctx: ParseContext): TagParseResult {
        const m = this.PATTERN.exec(line);
        if (!m) return new TagParseResult({ consumed: false });
        return new TagParseResult({
            step: { type: 'goto', target: m[1].trim() },
            consumed: true,
        });
    }

    execute(step: Step, _ctx: ExecContext): ExecResult {
        if (step.type !== 'goto') return null;
        return 'goto';
    }
}

/**
 * [pause duration/] or [pause duration block/] — timed pause.
 *
 * The `block` flag is stored on the step. Currently both forms
 * pause the scenario for `duration` ms and block the player from
 * advancing early. The flag is kept for future differentiation.
 */
export class PauseTag extends BaseTag {
    name = 'pause';
    private readonly PATTERN = /^\[pause\s+(?<duration>\d+)(?:\s+(?<block>block))?\/\]$/;

    parse(line: string, _lineIdx: number, _ctx: ParseContext): TagParseResult {
        const m = this.PATTERN.exec(line);
        if (!m || !m.groups) return new TagParseResult({ consumed: false });
        return new TagParseResult({
            step: {
                type: 'pause',
                duration: parseInt(m.groups.duration, 10),
                block: m.groups.block !== undefined,
            },
            consumed: true,
        });
    }

    execute(step: Step, _ctx: ExecContext): ExecResult {
        if (step.type !== 'pause') return null;
        return ['frame', step];
    }
}