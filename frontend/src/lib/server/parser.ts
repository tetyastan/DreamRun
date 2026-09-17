import fs from 'node:fs';
import { ALL_TAGS } from './tags/registry.js';
import { TagParseResult } from './tags/base.js';
import type { ParseContext, ParsedScript, Step, ScopeFrame } from './types.js';
import './tags/index.js'; 

export function parseDreamrunBlocks(filePath: string): ParsedScript | null {
    if (!fs.existsSync(filePath)) return null;

    const mainSteps: Step[] = [];
    const referencesMap: Record<string, Step[]> = {};

    const source = fs.readFileSync(filePath, 'utf-8');
    const lines = source.split('\n');

    const ctx: ParseContext = {
        scope_stack: [],
        in_script_block: false,
        script_lang: null,
        script_accumulator: [],
        _references_map: referencesMap,
        _main_steps_ref: mainSteps,
    };

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const rawLine = lines[lineIdx];
        const line = rawLine.trim();

        // -- Script block accumulation --
        // When inside a [python] or [ts] block, preserve raw content
        // until the matching close tag appears. The close tag falls
        // through to the tag dispatch loop below.
        if (ctx.in_script_block) {
            const isCloser =
                line === '[/python]' || line === '[/ts]';
            if (!isCloser) {
                ctx.script_accumulator.push(rawLine.replace(/\r$/, ''));
                continue;
            }
        }

        if (!line || line.startsWith('#')) continue;

        let handled = false;
        for (const tag of ALL_TAGS) {
            const result: TagParseResult = tag.parse(line, lineIdx, ctx);

            if (result.scope_open) ctx.scope_stack.push(result.scope_open);
            if (result.scope_close) closeScope(ctx, result.scope_close, lineIdx);
            if (result.step) routeStep(ctx, result.step, mainSteps);
            if (result.consumed) {
                handled = true;
                break;
            }
        }

        if (!handled) {
            throw new Error(
                `Engine Compilation Exception at line ${lineIdx + 1}: ` +
                `Unrecognized syntax expression context token: '${line}'`
            );
        }
    }

    if (ctx.scope_stack.length > 0) {
        const open = ctx.scope_stack.map(s => s.type).join(', ');
        throw new Error(`Syntax Error: Unclosed tags remaining: [${open}]`);
    }

    return { steps: mainSteps, references: referencesMap };
}

function routeStep(ctx: ParseContext, step: Step, mainSteps: Step[]): void {
    const stack = ctx.scope_stack;
    if (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (top.type === 'ref') {
            (top.steps as Step[]).push(step);
            return;
        }
        if (top.type === 'answer_paired') {
            (top.children as Step[]).push(step);
            return;
        }
        if (top.type === 'if_builder') {
            (top.current_branch_steps as Step[]).push(step);
            return;
        }
    }
    mainSteps.push(step);
}

function closeScope(ctx: ParseContext, expectedType: string, lineIdx: number): void {
    const stack = ctx.scope_stack;
    const top = stack[stack.length - 1];
    if (!top || top.type !== expectedType) {
        throw new Error(
            `Syntax Error line ${lineIdx + 1}: ` +
            `Mismatched closing tag for scope '${expectedType}'.`
        );
    }

    const frame = stack.pop()! as ScopeFrame & Record<string, unknown>;

    if (frame.type === 'ref') {
        const steps = frame.steps as Step[];
        if (steps.length === 0) {
            throw new Error(`Syntax Error: Reference block '${frame.name}' cannot be empty.`);
        }
        ctx._references_map[frame.name as string] = steps;
        return;
    }

    if (frame.type === 'choice') {
        routeStep(ctx, { type: 'choice', options: frame.answers }, ctx._main_steps_ref);
        return;
    }

    if (frame.type === 'answer_paired') {
        for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i].type === 'choice') {
                (stack[i].answers as unknown[]).push({
                    text: frame.text,
                    type: 'paired',
                    branches: frame.children,
                });
                return;
            }
        }
        throw new Error(`Syntax Error line ${lineIdx + 1}: Broken answer scope tracking.`);
    }

    if (frame.type === 'if_builder') {
        (frame.branches as unknown[]).push({
            mode: frame.current_branch_type,
            condition: frame.current_branch_expr,
            steps: frame.current_branch_steps,
        });
        routeStep(
            ctx,
            { type: 'conditional_block', branches: frame.branches },
            ctx._main_steps_ref
        );
        return;
    }
}