import { BaseTag, TagParseResult, type ExecResult } from './base.js';
import type { Step, ExecContext, ParseContext } from '../types.js';
import { loadConfigFile } from '../config_loader.js';

/**
 * Handles [config "filename"/].
 *
 * The tag only emits a `load_config` step. Actual module loading is
 * asynchronous, so the runtime awaits it via executeConfigStep below.
 *
 * Both quoted filenames and {var} placeholders are accepted. The .ts
 * extension is appended automatically when missing.
 */
export class ConfigTag extends BaseTag {
    name = 'config';
    private readonly PATTERN = /^\[config\s+(?:"([^"]+)"|(\{[A-Za-z0-9_.]+\}))\s*\/?\]$/;

    parse(line: string, _lineIdx: number, _ctx: ParseContext): TagParseResult {
        const m = this.PATTERN.exec(line);
        if (!m) return new TagParseResult({ consumed: false });

        let filename = (m[1] ?? m[2]).trim();
        if (!filename.endsWith('.ts') && !filename.endsWith('.js')) {
            filename = `${filename}.ts`;
        }

        return new TagParseResult({
            step: { type: 'load_config', filename },
            consumed: true,
        });
    }

    execute(_step: Step, _ctx: ExecContext): ExecResult {
        return null;
    }
}

/**
 * Async handler for the `load_config` step. Loads the module into the
 * session env.
 */
export async function executeConfigStep(step: Step, ctx: ExecContext): Promise<void> {
    if (step.type !== 'load_config') return;
    const filename = step.filename as string;
    await loadConfigFile(filename, ctx.env);
}