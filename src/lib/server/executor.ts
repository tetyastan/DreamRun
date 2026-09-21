import { ALL_TAGS } from './tags/registry.js';
import { evaluateStepParameters } from './evaluator.js';
import { executeScriptStep } from './tags/script.js';
import { executeConfigStep } from './tags/config_tag.js';
import { SESSIONS } from './sessions.js';
import type { ExecContext, Frame, Session, Step } from './types.js';
import type { ExecResult } from './tags/base.js';

/**
 * Executes a compiled scenario until one visible frame has been
 * collected, a choice is reached, or the end of the flat step
 * array is hit.
 *
 * The cursor is a plain integer into `compiled.steps`. It only ever
 * moves forward or jumps to a specific absolute index — there are no
 * nested arrays, no scope stacks, no reference resolution. Whatever
 * the cursor points at is the current step.
 *
 * [jump] pushes `cursor + 1` onto the return stack before jumping;
 * when the cursor reaches the end of the array and the return stack
 * is non-empty, the topmost address is popped and becomes the new
 * cursor. This is the only mechanism by which execution can leave a
 * segment it has entered.
 */
export async function executeCompiled(
    sessionId: string,
): Promise<{ steps: Frame[] }> {
    const session = SESSIONS.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    return runUntilVisible(session);
}

/**
 * Silently replays the scenario from index 0 up to `targetIndex`,
 * collecting every audio and image command that would have been
 * issued along the way. Returns the buffer and the frame at the
 * target index (if it is a visible step).
 *
 * Used only by restoreFromSaveFile. Does not mutate any global
 * state; the session it receives is discarded afterwards.
 */
export async function replayTo(
    session: Session,
    targetIndex: number,
): Promise<{
    audio: import('./types.js').AudioCommand[];
    images: import('./types.js').ImageCommand[];
    firstFrame: Frame | null;
    warnings: string[];
}> {
    const audio: import('./types.js').AudioCommand[] = [];
    const images: import('./types.js').ImageCommand[] = [];
    const warnings: string[] = [];
    let firstFrame: Frame | null = null;

    const env = session.runtime_env;
    const ctx: ExecContext = { session, env, dialogues: [] };

    let guard = 0;
    const GUARD_LIMIT = 200_000;

    while (session.cursor < targetIndex) {
        if (++guard > GUARD_LIMIT) {
            warnings.push('Replay guard tripped.');
            break;
        }

        const step = evaluateStepParameters(
            session.compiled.steps[session.cursor],
            env,
        ) as Step;

        // Server-side effects are skipped: variables are already
        // present in the snapshot, and re-running [python] or [ts]
        // is not guaranteed to produce the same result.
        if (step.type === 'script_exec' || step.type === 'load_config') {
            session.cursor += 1;
            continue;
        }

        // Drain staged commands into the buffers on every step that
        // has run its course. Visible frames and invisible steps
        // alike contribute their pending commands in order.
        if (step.type === 'dialogue' || step.type === 'pause') {
            session.cursor += 1;
            images.push(...session._pending_images);
            audio.push(...session._pending_audio);
            session._pending_audio = [];
            session._pending_images = [];
            continue;
        }

        if (step.type === 'choice') {
            // Replay through a choice: consult the recorded journal.
            // If the choice is not in the journal, this is the point
            // the player reached; stop here.
            const recorded = session.choices.find(c => c.index === session.cursor);
            if (!recorded) break;

            const opts = step.options as Array<{ branch_start: number }>;
            const branch = opts[recorded.choice];
            if (!branch) {
                warnings.push(`Choice branch missing at ${session.cursor}`);
                break;
            }
            // Execute the choice: push `after` onto the stack and jump
            // to the branch. This mirrors the runtime exactly.
            session.return_stack.push(step.after as number);
            session.cursor = branch.branch_start;
            continue;
        }

        if (step.type === 'conditional_block') {
            // Same idea as the runtime: find the first matching
            // branch, jump to it, push `after`.
            const branches = step.branches as Array<{
                mode: 'if' | 'elif' | 'else';
                condition: string | null;
                start: number;
            }>;
            const chosen = pickBranch(branches, env);
            if (chosen) {
                session.return_stack.push(step.after as number);
                session.cursor = chosen.start;
                continue;
            }
            // No branch matched: skip to `after`.
            session.cursor = step.after as number;
            continue;
        }

        if (step.type === 'jump') {
            session.return_stack.push(session.cursor + 1);
            session.cursor = step.target as number;
            continue;
        }

        if (step.type === 'goto') {
            session.cursor = step.target as number;
            continue;
        }

        if (step.type === 'return') {
            if (session.return_stack.length === 0) break;
            session.cursor = session.return_stack.pop()!;
            continue;
        }

        // Invisible steps (image, audio, pass): execute via tag
        // dispatch, drain staged commands, advance.
        session.cursor += 1;
        dispatch(step, ctx);
        images.push(...session._pending_images);
        audio.push(...session._pending_audio);
        session._pending_audio = [];
        session._pending_images = [];
    }

    // At the target: if it is a visible frame, materialise it for
    // the client. Otherwise, no firstFrame — the client will just
    // resume from the current scene.
    if (session.cursor === targetIndex) {
        const step = evaluateStepParameters(
            session.compiled.steps[targetIndex],
            env,
        ) as Step;
        if (step.type === 'dialogue' || step.type === 'pause') {
            const frame = buildFrameForStep(step, ctx);
            if (frame) firstFrame = frame;
            session.cursor += 1;
        }
    }

    return { audio, images, firstFrame, warnings };
}

/**
 * Core loop: runs until one visible frame is produced or the
 * scenario ends.
 */
async function runUntilVisible(session: Session): Promise<{ steps: Frame[] }> {
    const env = session.runtime_env;
    const dialogues: Frame[] = [];
    const ctx: ExecContext = { session, env, dialogues };

    session._pending_audio ??= [];
    session._pending_images ??= [];

    while (true) {
        // End of flat array: pop a return address or stop.
        if (session.cursor >= session.compiled.steps.length)
            break;

        // Stop as soon as we already produced a visible frame. Any
        // further invisible steps belong to the next advance.
        if (dialogues.length >= 1) break;

        const step = evaluateStepParameters(
            session.compiled.steps[session.cursor],
            env,
        ) as Step;

        if (step.type === 'script_exec') {
            session.cursor += 1;
            await executeScriptStep(step, ctx);
            continue;
        }

        if (step.type === 'load_config') {
            session.cursor += 1;
            await executeConfigStep(step, ctx);
            continue;
        }

        if (step.type === 'choice') {
            const opts = step.options as Array<{ text: string; branch_start: number }>;
            dialogues.push({
                type: 'choice',
                images: [...session._pending_images],
                audio: [...session._pending_audio],
                options: opts.map((o, i) => ({ index: i, text: o.text })),
            });
            session._pending_audio = [];
            session._pending_images = [];
            // The cursor stays on the choice step. The next message
            // from the client will be a `choice` and will advance
            // past it.
            break;
        }

        if (step.type === 'dialogue' || step.type === 'pause') {
            session.cursor += 1;
            const result = dispatch(step, ctx);
            if (Array.isArray(result) && result[0] === 'frame') {
                const frame = result[1] as unknown as Frame;
                frame.images = [...session._pending_images];
                frame.audio = [...session._pending_audio];
                session._pending_audio = [];
                session._pending_images = [];
                dialogues.push(frame);
            }
            continue;
        }

        if (step.type === 'jump') {
            session.return_stack.push(session.cursor + 1);
            session.cursor = step.target as number;
            continue;
        }

        if (step.type === 'goto') {
            session.cursor = step.target as number;
            continue;
        }

        if (step.type === 'conditional_block') {
            const branches = step.branches as Array<{
                mode: 'if' | 'elif' | 'else';
                condition: string | null;
                start: number;
            }>;
            const chosen = pickBranch(branches, env);
            if (chosen) {
                session.return_stack.push(step.after as number);
                session.cursor = chosen.start;
            } else {
                session.cursor = step.after as number;
            }
            continue;
        }

        if (step.type === 'return') {
            if (session.return_stack.length === 0) {
                // No caller: the scenario ends.
                break;
            }
            session.cursor = session.return_stack.pop()!;
            continue;
        }

        // Invisible steps: advance, dispatch, continue.
        session.cursor += 1;
        dispatch(step, ctx);
    }

    return { steps: dialogues };
}

function pickBranch(
    branches: Array<{
        mode: 'if' | 'elif' | 'else';
        condition: string | null;
        start: number;
    }>,
    env: Record<string, unknown>,
): { start: number } | null {
    for (const branch of branches) {
        if (branch.mode === 'else') return { start: branch.start };
        const cond = branch.condition ?? 'false';
        try {
            const fn = new Function(
                ...Object.keys(env).filter(k => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k)),
                `return (${cond});`,
            );
            const values = Object.keys(env)
                .filter(k => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k))
                .map(k => env[k]);
            if (Boolean(fn(...values))) return { start: branch.start };
        } catch {
            // Treat evaluation failures as false.
        }
    }
    return null;
}

function dispatch(step: Step, ctx: ExecContext): ExecResult {
    for (const tag of ALL_TAGS) {
        const result = tag.execute(step, ctx);
        if (result !== null) return result;
    }
    return null;
}

/**
 * Runs a dialogue/pause step through its tag and returns the frame
 * it produces. Used by replayTo to materialise the saved frame.
 */
function buildFrameForStep(step: Step, ctx: ExecContext): Frame | null {
    for (const tag of ALL_TAGS) {
        const result = tag.execute(step, ctx);
        if (result !== null && Array.isArray(result) && result[0] === 'frame') {
            return result[1] as unknown as Frame;
        }
    }
    return null;
}