import type { Step, ExecContext, ParseContext, ScopeFrame } from '../types.js';

export type ExecResult =
    | null
    | 'change_act'
    | 'jump'
    | 'goto'
    | ['inject', Step[]]
    | ['frame', Record<string, unknown>];

export class TagParseResult {
    step?: Step;
    consumed: boolean;
    scope_open?: ScopeFrame;
    scope_close?: string;

    constructor(init: Partial<TagParseResult> = {}) {
        this.step = init.step;
        this.consumed = init.consumed ?? false;
        this.scope_open = init.scope_open;
        this.scope_close = init.scope_close;
    }
}

export abstract class BaseTag {
    abstract name: string;

    parse(_line: string, _lineIdx: number, _ctx: ParseContext): TagParseResult {
        return new TagParseResult({ consumed: false });
    }

    execute(_step: Step, _ctx: ExecContext): ExecResult {
        return null;
    }
}