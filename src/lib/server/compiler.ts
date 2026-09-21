import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseDreamrunBlocks } from './parser.js';
import { SCENES_DIR, INDEX_ACT } from './config.js';
import type { Step, ParsedScript } from './types.js';

export const COMPILER_VERSION = 1;

export type CompiledAct = {
    name: string;
    start: number;
    end: number;
};

export type CompiledScript = {
    version: number;
    // Flat array of steps. Every jump/goto target, every
    // choice-branch address, and every conditional-branch address
    // is an index into this array.
    steps: Step[];
    // Named refs, indexed by their absolute position in `steps`.
    // Kept for diagnostics and for tooling.
    refs: Record<string, number>;
    // Which contiguous range of `steps` belongs to each act, in
    // walk order. Diagnostics only.
    acts: CompiledAct[];
    // SHA-256 over every source file visited during compilation.
    source_hash: string;
};

/**
 * Compiles a scenario into a flat step array.
 *
 * The compiler walks the act graph from the entry point, parses
 * every reachable act, and lays all steps into a single array.
 * Within that array:
 *
 *   - [jump ref] becomes [jump <absolute index>]. The runtime
 *     pushes cursor + 1 onto the return stack before jumping.
 *   - [goto ref] becomes [goto <absolute index>]. No return frame.
 *   - [next "act"] becomes [goto <absolute index>] of the next
 *     act's first step.
 *   - [choice] branches are relocated out of the choice step and
 *     into contiguous segments of the same flat array. The choice
 *     step stores only the start address of each branch and one
 *     shared `after` address.
 *   - [if] / [elif] / [else] branches are handled the same way.
 *   - [ref] declarations disappear as a concept: their bodies are
 *     laid out in the flat array, and `refs` maps each name to its
 *     start address.
 *
 * The order of steps is deterministic given the same source files,
 * which is what makes save/load trivial: a saved step_index is a
 * stable pointer into this array.
 */
export function compileScript(entryAct: string = INDEX_ACT): CompiledScript {
    const ctx = new CompileContext();
    ctx.walk(entryAct);
    ctx.resolveAll();
    return ctx.finish();
}

/**
 * Renders a compiled script as a human-readable table. Used for
 * debugging and for inspecting the output of the compiler when a
 * scenario behaves unexpectedly.
 */
export function dumpCompiled(script: CompiledScript): string {
    const lines: string[] = [];
    lines.push(`# CompiledScript v${script.version}`);
    lines.push(`# source_hash: ${script.source_hash.slice(0, 12)}`);
    lines.push(`# acts:`);
    for (const act of script.acts) {
        lines.push(`#   ${act.name}: [${act.start}..${act.end})`);
    }
    lines.push(`# refs:`);
    for (const [name, idx] of Object.entries(script.refs)) {
        lines.push(`#   ${name}: ${idx}`);
    }
    lines.push('');
    for (let i = 0; i < script.steps.length; i++) {
        const s = script.steps[i] as any;
        const idx = String(i).padStart(5, ' ');
        const type = String(s.type).padEnd(18, ' ');
        let detail = '';

        if (s.type === 'jump' || s.type === 'goto') {
            detail = `-> ${s.target}`;
        } else if (s.type === 'dialogue') {
            detail = `[${s.speaker_mode}] ${JSON.stringify(s.raw_text ?? '')}`;
        } else if (s.type === 'choice') {
            detail = `options=${s.options.length} after=${s.after} ` +
                `branches=[${s.options.map((o: any) => o.branch_start).join(', ')}]`;
        } else if (s.type === 'conditional_block') {
            detail = `branches=${s.branches.length} after=${s.after} ` +
                `starts=[${s.branches.map((b: any) => b.start).join(', ')}]`;
        } else if (s.type === 'script_exec') {
            detail = `[${s.lang}]`;
        } else if (s.type === 'image') {
            detail = `${s.modifier} ${s.id}`;
        } else if (s.type === 'audio') {
            detail = `${s.modifier} ${s.id}`;
        } else if (s.type === 'pause') {
            detail = `duration=${s.duration} block=${s.block}`;
        } else if (s.type === 'load_config') {
            detail = `${s.filename}`;
        }

        lines.push(`${idx}  ${type} ${detail}`);
    }
    return lines.join('\n');
}

// ---------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------

type PendingJump = { at: number; refName: string };
type PendingNext = { at: number; actName: string };
type PendingExit = { at: number; kind: 'choice' | 'conditional'; ownerAt: number };

class CompileContext {
    steps: Step[] = [];
    refs: Record<string, number> = {};
    acts: CompiledAct[] = [];
    sourceFiles: string[] = [];

    // Deferred resolution queues. Filled during walk, drained in
    // resolveAll.
    private pendingJumps: PendingJump[] = [];
    private pendingNexts: PendingNext[] = [];
    private pendingExits: PendingExit[] = [];
    private pendingChoices: Array<{ at: number; branches: Array<{ text: string; start: number }> }> = [];
    private pendingConditionals: Array<{
        at: number;
        branches: Array<{ mode: 'if' | 'elif' | 'else'; condition: string | null; start: number }>;
    }> = [];

    // Act name -> first step index.
    private actStart: Record<string, number> = {};

    // Choice/conditional step index -> after-address, filled during
    // emission. Avoids a second pass over the flat array.
    private exitAfter: Map<number, number> = new Map();

    /**
     * Walks the act graph starting at `entryAct`.
     *
     * For each act: emits its main-line steps, then emits every
     * [ref] body that belongs to it. Both sets of steps can contain
     * [next]; the walk follows the first one it encounters, but
     * emits all acts reachable from any [next] before returning.
     *
     * Visited acts are tracked so that a cycle in the act graph
     * stops the walk instead of looping forever.
     */
    walk(entryAct: string): void {
        const visited = new Set<string>();
        const queue: string[] = [entryAct];

        while (queue.length > 0) {
            const actName = queue.shift()!;
            if (visited.has(actName)) continue;
            visited.add(actName);

            const actPath = path.join(SCENES_DIR, actName);
            const parsed = parseDreamrunBlocks(actPath);
            if (!parsed) {
                throw new Error(`COMPILE_ACT_MISSING:${actName}`);
            }
            this.sourceFiles.push(actPath);

            const start = this.steps.length;
            this.actStart[actName] = start;

            // Emit main-line steps.
            for (const step of parsed.steps) {
                this.emitStep(step, queue);
            }

            // Emit this act's refs. They live in the flat array but
            // outside the act's main-line range.
            for (const [name, refSteps] of Object.entries(parsed.references)) {
                this.refs[name] = this.steps.length;
                for (const refStep of refSteps) {
                    this.emitStep(refStep, queue);
                }
                // Return from the ref: pop the return stack. The runtime
                // treats this as "jump to return_stack.pop() or end if empty".
                this.steps.push({ type: 'return' });
            }

            const end = this.steps.length;
            this.acts.push({ name: actName, start, end });
        }
    }

    /**
     * Emits one step, translating constructs that need address
     * resolution into placeholder form and pushing the target act
     * of any [next] onto the queue.
     */
    private emitStep(step: Step, queue: string[]): void {
        switch (step.type) {
            case 'change_act': {
                const target = path.basename(step.next_act_path as string);
                const at = this.steps.length;
                this.steps.push({ type: 'goto', target: -1 });
                this.pendingNexts.push({ at, actName: target });
                if (!queue.includes(target)) queue.push(target);
                return;
            }

            case 'jump':
            case 'goto': {
                const at = this.steps.length;
                this.steps.push({ type: step.type, target: -1 });
                this.pendingJumps.push({ at, refName: step.target as string });
                return;
            }

            case 'choice':
                this.emitChoice(step, queue);
                return;

            case 'conditional_block':
                this.emitConditional(step, queue);
                return;

            default:
                this.steps.push(step);
        }
    }

    /**
     * Emits a choice step and its branches.
     *
     * The choice step itself is a placeholder with empty options and
     * after = -1. Each branch is a contiguous segment of `steps`,
     * followed by a terminating goto that jumps to the choice's
     * `after` address. Both addresses are filled in during resolve.
     */
    private emitChoice(step: Step, queue: string[]): void {
        const options = (step.options as Array<{
            text: string;
            type: 'paired' | 'self_closing';
            branches?: Step[];
            action?: Step;
        }>) || [];

        const choiceAt = this.steps.length;
        this.steps.push({ type: 'choice', options: [], after: -1 });

        const branches: Array<{ text: string; start: number }> = [];

        for (const opt of options) {
            const branchStart = this.steps.length;

            const body = opt.type === 'paired'
                ? (opt.branches ?? [])
                : (opt.action ? [opt.action] : []);

            for (const bStep of body) {
                this.emitStep(bStep, queue);
            }

            // Every branch ends by jumping to `after`. The target is
            // resolved when the choice step is closed.
            const exitAt = this.steps.length;
            this.steps.push({ type: 'goto', target: -1 });
            this.pendingExits.push({ at: exitAt, kind: 'choice', ownerAt: choiceAt });

            branches.push({ text: opt.text, start: branchStart });
        }

        // The after-address is the position right after the last
        // branch's terminating goto. It is known as soon as the last
        // branch has been emitted.
        this.exitAfter.set(choiceAt, this.steps.length);
        this.pendingChoices.push({ at: choiceAt, branches });
    }

    /**
     * Emits a conditional_block and its branches, in the same
     * shape as a choice: each branch is a contiguous segment,
     * followed by a goto to the block's `after`.
     */
    private emitConditional(step: Step, queue: string[]): void {
        const branches = (step.branches as Array<{
            mode: 'if' | 'elif' | 'else';
            condition: string | null;
            steps: Step[];
        }>) || [];

        const condAt = this.steps.length;
        this.steps.push({ type: 'conditional_block', branches: [], after: -1 });

        const pending: Array<{
            mode: 'if' | 'elif' | 'else';
            condition: string | null;
            start: number;
        }> = [];

        for (const branch of branches) {
            const branchStart = this.steps.length;

            for (const bStep of branch.steps) {
                this.emitStep(bStep, queue);
            }

            const exitAt = this.steps.length;
            this.steps.push({ type: 'goto', target: -1 });
            this.pendingExits.push({ at: exitAt, kind: 'conditional', ownerAt: condAt });

            pending.push({
                mode: branch.mode,
                condition: branch.condition,
                start: branchStart,
            });
        }

        this.exitAfter.set(condAt, this.steps.length);
        this.pendingConditionals.push({ at: condAt, branches: pending });
    }

    /**
     * Second pass: replace every placeholder with a real address.
     *
     * By this point every act, ref, and branch body has been laid
     * down in `steps`. All indices are final.
     */
    resolveAll(): void {
        // [jump]/[goto] targets: ref name -> absolute index.
        for (const p of this.pendingJumps) {
            const target = this.refs[p.refName];
            if (target === undefined) {
                throw new Error(`COMPILE_REF_NOT_FOUND:${p.refName}`);
            }
            (this.steps[p.at] as any).target = target;
        }

        // [next] targets: act name -> absolute index of first step.
        for (const p of this.pendingNexts) {
            const start = this.actStart[p.actName];
            if (start === undefined) {
                throw new Error(`COMPILE_NEXT_ACT_NOT_VISITED:${p.actName}`);
            }
            (this.steps[p.at] as any).target = start;
        }

        // Branch exits: point each terminating goto at the owner's
        // after-address.
        for (const p of this.pendingExits) {
            const after = this.exitAfter.get(p.ownerAt);
            if (after === undefined) {
                throw new Error(`COMPILE_EXIT_OWNER_NOT_FOUND:${p.ownerAt}`);
            }
            (this.steps[p.at] as any).target = after;
        }

        // Fill in choice and conditional step bodies with resolved
        // addresses.
        for (const c of this.pendingChoices) {
            const step = this.steps[c.at] as any;
            step.options = c.branches.map(b => ({
                text: b.text,
                branch_start: b.start,
            }));
            step.after = this.exitAfter.get(c.at)!;
        }

        for (const c of this.pendingConditionals) {
            const step = this.steps[c.at] as any;
            step.branches = c.branches.map(b => ({
                mode: b.mode,
                condition: b.condition,
                start: b.start,
            }));
            step.after = this.exitAfter.get(c.at)!;
        }
    }

    finish(): CompiledScript {
        return {
            version: COMPILER_VERSION,
            steps: this.steps,
            refs: this.refs,
            acts: this.acts,
            source_hash: hashFiles(this.sourceFiles),
        };
    }
}

function hashFiles(files: string[]): string {
    const hash = crypto.createHash('sha256');
    for (const f of files) {
        hash.update(f);
        hash.update('\0');
        hash.update(fs.readFileSync(f));
        hash.update('\0');
    }
    return hash.digest('hex');
}