/**
 * Shared runtime shapes.
 *
 * A `Step` is produced by the parser and consumed by the runtime.
 * A `Frame` is produced by the runtime and consumed by the client.
 */

export type Step = {
    type: string;
    lang?: 'python' | 'ts';
    code?: string;
    [key: string]: unknown;
};

export type Frame = {
    type: 'dialogue' | 'choice' | 'pause' | 'game_end';
    name?: string | null;
    text?: string;
    options?: Array<{ index: number; text: string }>;
    duration?: number;
    block?: boolean;
    images?: ImageCommand[];
    audio?: AudioCommand[];
};

export type ImageCommand = {
    modifier: 'show' | 'modify' | 'hide';
    id: string;
    img_path?: string;
    layer?: number;
    container_css?: string | null;
    image_css?: string | null;
};

export type AudioCommand = {
    modifier: 'sound' | 'music' | 'modify' | 'pause' | 'resume' | 'stop';
    id: string;
    path?: string;
    volume?: unknown;
    pitch?: unknown;
};

/**
 * A scope frame is pushed on the parser's scope_stack whenever a
 * block tag opens and popped when the matching close tag appears.
 */
export type ScopeFrame = {
    type: 'ref' | 'choice' | 'answer_paired' | 'if_builder';
    [key: string]: unknown;
};

/**
 * A serializable pointer to the fragment of the scenario that is
 * currently executing.
 *
 * Used by the save system to reconstruct the runtime's position
 * without serializing the step arrays themselves: at load time we
 * re-parse the act and walk the same path from the top.
 */
export type ScopeRef =
    | { kind: 'main' }
    | { kind: 'ref'; name: string }
    | {
        kind: 'choice_branch';
        parent: ScopeRef;
        index: number;
        branch: number;
    };

export type ParseContext = {
    scope_stack: ScopeFrame[];
    in_script_block: boolean;
    script_lang: 'python' | 'ts' | null;
    script_accumulator: string[];
    _references_map: Record<string, Step[]>;
    _main_steps_ref: Step[];
};

export type ExecContext = {
    session: Session;
    env: Record<string, unknown>;
    dialogues: Frame[];
};

/**
 * A saved position on the return stack.
 *
 * Mirrors Session.return_stack, but the step array is captured as a
 * ScopeRef so that it can be safely re-derived after a reload.
 */
export type ReturnFrame = {
    steps: Step[];
    index: number;
    scope: ScopeRef;
};

/**
 * One recorded choice during a playthrough.
 *
 * Replay uses this list to walk the same branches the player took
 * without stopping at every choice. Matching is positional: the
 * runtime looks up an entry by (act, index), and only if the entry
 * exists does it apply the recorded branch. If the entry is missing,
 * replay stops at that choice and the client is shown the prompt.
 */
export type RecordedChoice = {
    // The absolute index of the choice step in compiled.steps.
    index: number;
    // Which option was selected.
    choice: number;
};

/**
 * A session tracks one playthrough.
 *
 * The snapshot stored by the save system contains only the pointer,
 * the visited acts, the choices made, and the runtime environment.
 * Everything else — audio state, images, return stack — is
 * reconstructed at load time by replaying the scenario from the
 * first act up to the saved pointer.
 */
export type Session = {
    // The compiled scenario this session plays against. Shared
    // across all sessions that use the same source hash.
    compiled: CompiledScript;

    // Position in compiled.steps. The one and only pointer.
    cursor: number;

    // Return stack: addresses to resume from after a [jump]
    // completes. Plain numbers, no arrays, no scope references.
    return_stack: number[];

    // User variables, characters, flags.
    runtime_env: Record<string, unknown>;

    // Choices recorded during this playthrough. Used for replays
    // and for saves.
    choices: RecordedChoice[];

    // Pending audio/image commands staged for the next visible
    // frame.
    _pending_audio: AudioCommand[];
    _pending_images: ImageCommand[];

    // Diagnostics.
    last_request_time: number;
    last_choice_time: number;
};

export type ParsedScript = {
    steps: Step[];
    references: Record<string, Step[]>;
};

export type CompiledScript = {
    version: number;
    // Source acts, in the order they were visited during compilation.
    // Used for diagnostics and for resolving drift when the script is
    // edited between compilations.
    acts: CompiledAct[];

    // The flat list of steps. Every jump, goto, or choice-branch
    // reference in this array is an absolute index into this same
    // array.
    steps: Step[];

    // Named references discovered during compilation. Each maps to a
    // position in `steps`. Kept for debugging and for tooling that
    // wants to reconstruct the original scope names.
    refs: Record<string, number>;

    // Hash of the source files used to build this script. Used by the
    // cache to decide whether a re-compilation is needed.
    source_hash: string;
};

export type CompiledAct = {
    name: string;
    // Half-open range [start, end) into `steps`. Every step in this
    // range belongs to this act.
    start: number;
    end: number;
};

// A [jump] now targets an absolute index in `steps`. The runtime
// pushes `cursor + 1` onto the return stack before jumping.
export type JumpStep = {
    type: 'jump';
    target: number;
};

// A [goto] is identical to [jump] except it does not push a
// return frame.
export type GotoStep = {
    type: 'goto';
    target: number;
};

// A [choice] now stores an address table. Each branch is a
// contiguous segment starting at `branch_start[i]`. After the
// branch finishes, control jumps to `resume_after_branch`.
export type ChoiceStep = {
    type: 'choice';
    options: Array<{ text: string; branch_start: number }>;
    // Where to return after the chosen branch ends. Every branch
    // jumps here on completion.
    after: number;
};

// A conditional_block has the same shape as before, but each
// branch's body is now a contiguous segment elsewhere in `steps`.
// The step stores start and end for each branch, and an `after`
// address that all branches converge on.
export type ConditionalStep = {
    type: 'conditional_block';
    branches: Array<{
        mode: 'if' | 'elif' | 'else';
        condition: string | null;
        start: number;
        end: number;
    }>;
    after: number;
};

// A return step pops the top of the return stack and continues
// from there. Inserted by the compiler at the end of every [ref]
// body. If the return stack is empty at runtime, the scenario
// ends.
export type ReturnStep = {
    type: 'return';
};