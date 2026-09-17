import path from 'node:path';
import { SESSIONS } from './sessions.js';
import { parseDreamrunBlocks } from './parser.js';
import { ALL_TAGS } from './tags/registry.js';
import { evaluateStepParameters } from './evaluator.js';
import { executeScriptStep } from './tags/script.js';
import { SCENES_DIR, PREFETCH_COUNT } from './config.js';
import type { ExecContext, Frame, Session, Step } from './types.js';
import type { ExecResult } from './tags/base.js';
import { executeConfigStep } from './tags/config_tag.js';

export async function executeRuntime(
    sessionId: string,
    maxDialogues = PREFETCH_COUNT
): Promise<{ steps: Frame[] }> {
    const session = SESSIONS.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const env = session.runtime_env;
    const dialogues: Frame[] = [];

    session._pending_audio ??= [];
    session._pending_images ??= [];

    const ctx: ExecContext = { session, env, dialogues };

    while (true) {
        if (session.step_index >= session.cached_steps.length) {
            const frame = session.return_stack.pop();
            if (frame) {
                session.cached_steps = frame.steps;
                session.step_index = frame.index;
                continue;
            }
            break;
        }

        const rawStep = session.cached_steps[session.step_index];
        const step = evaluateStepParameters(rawStep, env) as Step;

        const visible =
            step.type === 'dialogue' ||
            step.type === 'choice' ||
            step.type === 'pause';
        if (visible && dialogues.length >= maxDialogues) break;

        // --- Async script execution happens before any dispatch ---
        if (step.type === 'script_exec') {
            session.step_index += 1;
            await executeScriptStep(step, ctx);
            continue;
        }

        if (step.type === 'load_config') {
            session.step_index += 1;
            await executeConfigStep(step, ctx);
            continue;
        }

        if (step.type === 'choice') {
            dialogues.push({
                type: 'choice',
                images: [...session._pending_images],
                audio: [...session._pending_audio],
                options: (step.options as Array<{ text: string }>).map((o, i) => ({
                    index: i,
                    text: o.text,
                })),
            });
            session._pending_audio = [];
            session._pending_images = [];
            break;
        }

        if (step.type === 'dialogue' || step.type === 'pause') {
            session.step_index += 1;
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

        session.step_index += 1;
        const result = dispatch(step, ctx);

        if (result === 'change_act') {
            const targetName = path.basename(step.next_act_path as string);
            const nextFile = path.join(SCENES_DIR, targetName);
            const data = parseDreamrunBlocks(nextFile);
            if (!data) throw new Error(`Next act file not found: ${targetName}`);
            session.current_act = nextFile;
            session.cached_steps = data.steps;
            session.step_index = 0;
            session.references = data.references;
            session.return_stack = [];
            break;
        }

        if (result === 'jump' || result === 'goto') {
            const target = step.target as string;
            const ref = session.references[target];
            if (!ref) throw new Error(`Reference not found: ${target}`);
            if (result === 'jump') {
                session.return_stack.push({
                    steps: session.cached_steps,
                    index: session.step_index,
                });
            }
            session.cached_steps = [...ref];
            session.step_index = 0;
            continue;
        }

        if (Array.isArray(result) && result[0] === 'inject') {
            const nested = result[1] as Step[];
            for (let i = nested.length - 1; i >= 0; i--) {
                session.cached_steps.splice(session.step_index, 0, nested[i]);
            }
            continue;
        }
    }

    return { steps: dialogues };
}

function dispatch(step: Step, ctx: ExecContext): ExecResult {
    for (const tag of ALL_TAGS) {
        const result = tag.execute(step, ctx);
        if (result !== null) return result;
    }
    return null;
}