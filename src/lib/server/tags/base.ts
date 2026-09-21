import type { Step, ExecContext, ParseContext, ScopeFrame } from '../types.js';

/**
 * What a tag's execute() can return:
 *
 *   null                — step not handled; try the next tag
 *   'change_act'        — trigger an act swap
 *   'jump'              — push a return frame and switch to a ref
 *   'goto'              — switch to a ref without a return frame
 *   ['inject', steps]   — insert steps ahead of the pointer
 *   ['frame', data]     — emit a visible frame
 */
export type ExecResult =
    | null
    | 'change_act'
    | 'jump'
    | 'goto'
    | ['inject', Step[]]
    | ['frame', Record<string, unknown>];

/**
 * Result of a tag's parse() call.
 *
 * `consumed: true` claims the line. The other fields describe what
 * the tag produced:
 *   - step:       an executable step dict, or undefined
 *   - scope_open: a new frame to push on the scope stack
 *   - scope_close: the scope type the tag is closing
 */
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

/**
 * Base class for every tag.
 *
 * Subclasses override `parse` to recognize their lines and, optionally,
 * `execute` to handle their steps in the runtime. Tags that only open
 * scopes implement `parse` alone.
 */
export abstract class BaseTag {
    abstract name: string;

    parse(_line: string, _lineIdx: number, _ctx: ParseContext): TagParseResult {
        return new TagParseResult({ consumed: false });
    }

    execute(_step: Step, _ctx: ExecContext): ExecResult {
        return null;
    }
}