export type SaveMetadata = {
    timestamp: number;
    savestamp: string | null;
    sceneName: string | null;
    screenshot: string | null;
};

export type RecordedChoice = {
    // Absolute index of the choice step in compiled.steps.
    index: number;
    // Which option was selected.
    choice: number;
};

/**
 * A saved playthrough.
 *
 * Under the compiled model a save contains only the cursor into the
 * flat step array, the return stack of addresses, the choices made,
 * and the runtime environment. Everything else is re-derived by
 * replaying the scenario from the beginning to the saved cursor.
 */
export type Snapshot = {
    version: number;
    cursor: number;
    return_stack: number[];
    choices: RecordedChoice[];
    runtime_env: Record<string, unknown>;
    // Hash of the source files at save time. Used at load time to
    // detect a scenario edit that would invalidate the cursor.
    source_hash: string;
};

export type SaveFile = {
    magic: 'DREAMSAVE';
    version: number;
    metadata: SaveMetadata;
    payload: string;
};