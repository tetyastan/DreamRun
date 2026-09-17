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

export type ScopeFrame = {
    type: 'ref' | 'choice' | 'answer_paired' | 'if_builder';
    [key: string]: unknown;
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

export type Session = {
    current_act: string;
    cached_steps: Step[];
    step_index: number;
    runtime_env: Record<string, unknown>;
    references: Record<string, Step[]>;
    return_stack: Array<{ steps: Step[]; index: number }>;
    last_request_time: number;
    last_choice_time: number;
    _pending_audio: AudioCommand[];
    _pending_images: ImageCommand[];
};

export type ParsedScript = {
    steps: Step[];
    references: Record<string, Step[]>;
};