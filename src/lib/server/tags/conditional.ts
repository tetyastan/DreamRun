import { BaseTag, TagParseResult, type ExecResult } from './base.js';
import type { Step, ExecContext, ParseContext } from '../types.js';

interface Branch {
    mode: 'if' | 'elif' | 'else';
    condition: string | null;
    steps: Step[];
}

/**
 * Handles [if expr], [elif expr], [else], [/if].
 *
 * Conditions are evaluated as JavaScript expressions against the
 * shared runtime env. The distinction between Python and TS
 * expressions is not made here — see the Wiki for the rationale.
 */
export class ConditionalTag extends BaseTag {
    name = 'conditional';

    private readonly IF = /^\[if\s+(.+)\]$/;
    private readonly ELIF = /^\[(?:elif|else\s+if)\s+(.+)\]$/;
    private readonly ELSE = /^\[else\]$/;
    private readonly CLOSE = /^\[\/if\]$/;

    parse(line: string, lineIdx: number, ctx: ParseContext): TagParseResult {
        const stack = ctx.scope_stack;

        const ifm = this.IF.exec(line);
        if (ifm) {
            return new TagParseResult({
                consumed: true,
                scope_open: {
                    type: 'if_builder',
                    branches: [],
                    current_branch_type: 'if',
                    current_branch_expr: ifm[1].trim(),
                    current_branch_steps: [],
                },
            });
        }

        const elifm = this.ELIF.exec(line);
        if (elifm) {
            const top = stack[stack.length - 1];
            if (!top || top.type !== 'if_builder') {
                throw new Error(
                    `Syntax Error line ${lineIdx + 1}: ` +
                    `Unexpected [elif] without an open [if].`
                );
            }
            if (top.current_branch_type === 'else') {
                throw new Error(
                    `Syntax Error line ${lineIdx + 1}: ` +
                    `[elif] cannot come after [else].`
                );
            }
            (top.branches as Branch[]).push({
                mode: top.current_branch_type as Branch['mode'],
                condition: top.current_branch_expr as string,
                steps: top.current_branch_steps as Step[],
            });
            top.current_branch_type = 'elif';
            top.current_branch_expr = elifm[1].trim();
            top.current_branch_steps = [];
            return new TagParseResult({ consumed: true });
        }

        if (this.ELSE.test(line)) {
            const top = stack[stack.length - 1];
            if (!top || top.type !== 'if_builder') {
                throw new Error(
                    `Syntax Error line ${lineIdx + 1}: ` +
                    `Unexpected [else] without an open [if].`
                );
            }
            if (top.current_branch_type === 'else') {
                throw new Error(
                    `Syntax Error line ${lineIdx + 1}: ` +
                    `Duplicate [else] in a single conditional block.`
                );
            }
            (top.branches as Branch[]).push({
                mode: top.current_branch_type as Branch['mode'],
                condition: top.current_branch_expr as string,
                steps: top.current_branch_steps as Step[],
            });
            top.current_branch_type = 'else';
            top.current_branch_expr = null;
            top.current_branch_steps = [];
            return new TagParseResult({ consumed: true });
        }

        if (this.CLOSE.test(line)) {
            const top = stack[stack.length - 1];
            if (!top || top.type !== 'if_builder') {
                throw new Error(`Syntax Error line ${lineIdx + 1}: Mismatched [/if].`);
            }
            return new TagParseResult({ consumed: true, scope_close: 'if_builder' });
        }

        return new TagParseResult({ consumed: false });
    }

    execute(step: Step, ctx: ExecContext): ExecResult {
        if (step.type !== 'conditional_block') return null;

        const branches = step.branches as Branch[];

        for (const branch of branches) {
            if (branch.mode === 'if' || branch.mode === 'elif') {
                const condition = branch.condition ?? 'false';
                let result: boolean;
                try {
                    result = evaluateCondition(condition, ctx.env);
                } catch (err) {
                    throw new Error(
                        `CONDITIONAL_EVAL_ERROR: '${condition}' — ${String(err)}`
                    );
                }
                if (result) return ['inject', branch.steps];
            } else {
                return ['inject', branch.steps];
            }
        }

        return null;
    }
}

function evaluateCondition(expr: string, env: Record<string, unknown>): boolean {
    const keys = Object.keys(env).filter(k => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k));
    const values = keys.map(k => env[k]);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(...keys, `return (${expr});`);
    return Boolean(fn(...values));
}