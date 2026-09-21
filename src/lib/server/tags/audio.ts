import fs from 'node:fs';
import path from 'node:path';
import { BaseTag, TagParseResult, type ExecResult } from './base.js';
import type { Step, ExecContext, ParseContext, AudioCommand } from '../types.js';
import { ASSETS_DIR } from '../config.js';
import { parseAnimatedValue } from '../text_utils.js';
import { AssetMissingError } from '../errors.js';

/**
 * Handles the [audio ...] family:
 *
 *     [audio sound "path" id "volume" "pitch"/]
 *     [audio music "path" id "volume" "pitch"/]
 *     [audio modify id "volume" "pitch"/]
 *     [audio pause id/]
 *     [audio resume id/]
 *     [audio stop id/]
 *
 * Volume and pitch accept either a literal value, an animation form
 * (0.5~2000), or an explicit ramp (0..0.5 : 2000). Payloads are
 * normalised to { value, duration_ms } or { from, to, duration_ms }
 * before reaching the client.
 */
export class AudioTag extends BaseTag {
    name = 'audio';

    private readonly PATTERN =
        /^\[audio\s+(sound|music|modify|pause|resume|stop)\s+(.+?)\s*\/?\]$/;

    parse(line: string, _lineIdx: number, _ctx: ParseContext): TagParseResult {
        const m = this.PATTERN.exec(line);
        if (!m) return new TagParseResult({ consumed: false });

        const modifier = m[1];
        const tokens = tokenizeArgs(m[2]);
        const step: Step = { type: 'audio', modifier };

        if (modifier === 'sound' || modifier === 'music') {
            if (tokens.length < 2) {
                throw new Error(`[audio ${modifier}] requires "path" and id`);
            }
            step.path = unquote(tokens[0]);
            step.id = unquote(tokens[1]);
            step.volume = tokens[2] ? unquote(tokens[2]) : '1.0';
            step.pitch = tokens[3] ? unquote(tokens[3]) : '1.0';
        } else if (modifier === 'modify') {
            if (tokens.length < 2) {
                throw new Error(`[audio modify] requires id and "volume"`);
            }
            step.id = unquote(tokens[0]);
            step.volume = unquote(tokens[1]);
            step.pitch = tokens[2] ? unquote(tokens[2]) : null;
        } else {
            if (tokens.length < 1) {
                throw new Error(`[audio ${modifier}] requires an id`);
            }
            step.id = unquote(tokens[0]);
        }

        return new TagParseResult({ step, consumed: true });
    }

    execute(step: Step, ctx: ExecContext): ExecResult {
        if (step.type !== 'audio') return null;

        const session = ctx.session;
        const command: AudioCommand = {
            modifier: step.modifier as AudioCommand['modifier'],
            id: step.id as string,
        };

        if (step.modifier === 'sound' || step.modifier === 'music') {
            command.path = resolveAudioPath(step.path as string);
            command.volume = resolveAudioPayload(step.volume, 0.0);
            command.pitch = resolveAudioPayload(step.pitch, 1.0);
        } else if (step.modifier === 'modify') {
            // `null` for defaultFrom tells the client to use the current
            // value as the ramp's starting point.
            command.volume = resolveAudioPayload(step.volume, null);
            command.pitch =
                step.pitch !== null && step.pitch !== undefined
                    ? resolveAudioPayload(step.pitch, null)
                    : null;
        }

        session._pending_audio.push(command);
        return null;
    }
}

/**
 * Resolves an audio path under /assets/... and verifies existence.
 * Absolute URLs are passed through.
 */
function resolveAudioPath(raw: string): string {
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
        return raw;
    }
    if (raw.startsWith('/assets/')) {
        const abs = path.join(ASSETS_DIR, raw.replace('/assets/', ''));
        if (!fs.existsSync(abs)) {
            throw new AssetMissingError('AUDIO', raw, abs);
        }
        return raw;
    }
    if (raw.startsWith('/')) {
        const abs = path.join(ASSETS_DIR, raw.replace(/^\//, ''));
        if (!fs.existsSync(abs)) {
            throw new AssetMissingError('AUDIO', raw, abs);
        }
        return `/assets${raw}`;
    }
    return raw;
}

/**
 * Normalises a volume or pitch payload to the shape the client
 * expects:
 *   - { value, duration_ms } for a plain value
 *   - { from, to, duration_ms } for an animation
 *   - null if the input was null
 *
 * Strings are parsed through parseAnimatedValue. Objects are passed
 * through or rewritten depending on their shape.
 */
function resolveAudioPayload(value: unknown, defaultFrom: number | null): unknown {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return { value, duration_ms: 0 };

    if (typeof value === 'string') {
        const parsed = parseAnimatedValue(value, defaultFrom);
        if (parsed === null) {
            return { value: defaultFrom ?? 1.0, duration_ms: 0 };
        }
        if (typeof parsed === 'number') {
            return { value: parsed, duration_ms: 0 };
        }
        return { to: parsed.to, duration_ms: parsed.duration_ms, from: parsed.from };
    }

    if (typeof value === 'object') {
        if ('to' in (value as object)) return value;
        if ('value' in (value as object)) {
            return { to: (value as any).value, duration_ms: (value as any).duration_ms || 0, from: defaultFrom };
        }
    }

    return { value: defaultFrom ?? 1.0, duration_ms: 0 };
}

/**
 * Splits the argument string of an [audio] tag into tokens, respecting
 * quoted sections.
 */
function tokenizeArgs(raw: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inQuotes = false;

    for (const ch of raw) {
        if (ch === '"') {
            inQuotes = !inQuotes;
            current += ch;
        } else if (/\s/.test(ch) && !inQuotes) {
            if (current.length > 0) {
                tokens.push(current);
                current = '';
            }
        } else {
            current += ch;
        }
    }
    if (current.length > 0) tokens.push(current);
    return tokens;
}

function unquote(s: string): string {
    return s.replace(/^"|"$/g, '');
}