import { registerTag } from './registry.js';
import { PythonTag, TsTag } from './script.js';
import { ConfigTag } from './config_tag.js';
import { ImageTag } from './visual.js';
import { AudioTag } from './audio.js';
import { PassTag, NextTag, JumpTag, GotoTag, PauseTag } from './flow.js';
import { RefTag, ChoiceTag, AnswerTag } from './scope.js';
import { ConditionalTag } from './conditional.js';
import {
    VariableSpeakerTag,
    LiteralSpeakerTag,
    NarratorTag,
} from './dialogue.js';

let bootstrapped = false;

export function bootstrapTags(): void {
    if (bootstrapped) return;
    bootstrapped = true;

    const tags = [
        new PythonTag(),
        new TsTag(),
        new ConfigTag(),
        new ImageTag(),
        new AudioTag(),
        new PassTag(),
        new PauseTag(),
        new NextTag(),
        new JumpTag(),
        new GotoTag(),
        new RefTag(),
        new ChoiceTag(),
        new AnswerTag(),
        new ConditionalTag(),
        new VariableSpeakerTag(),
        new LiteralSpeakerTag(),
        new NarratorTag(),
    ];

    for (const t of tags) registerTag(t);
}

bootstrapTags();