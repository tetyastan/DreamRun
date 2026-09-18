import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CONFIG_DIR, DEFAULT_CONFIG_FILE } from './config.js';
import type { Session } from './types.js';

/**
 * Loads a config file (.ts or .js) into the runtime env.
 *
 * In development Vite handles .ts transpilation on the fly.
 * In production the config files should be compiled to .js during
 * the build. If only .ts files exist at runtime, the engine will
 * attempt to load them anyway and fail with a clear error.
 */
export async function loadConfigFile(
    filename: string,
    env: Record<string, unknown>
): Promise<void> {
    const target = ensureExtension(filename);

    const absolute = path.isAbsolute(target)
        ? target
        : path.join(CONFIG_DIR, target);

    if (!fs.existsSync(absolute)) {
        throw new Error(`CONFIG_FILE_MISSING_ERROR: ${absolute}`);
    }

    const url = pathToFileURL(absolute).href;
    const mod = await import(/* @vite-ignore */ url);

    for (const [key, value] of Object.entries(mod)) {
        if (key === 'default') continue;
        if (key.startsWith('__')) continue;
        if (key === 'Character') continue;   // ← добавить
        if (key === 'Ramp') continue;        // ← добавить
        env[key] = value;
    }

    const defaultExport = (mod as { default?: unknown }).default;
    if (defaultExport && typeof defaultExport === 'object') {
        for (const [key, value] of Object.entries(defaultExport)) {
            if (key === 'Character') continue;
            if (key === 'Ramp') continue;
            env[key] = value;
        }
    }
}

function ensureExtension(filename: string): string {
    if (filename.endsWith('.ts') || filename.endsWith('.js')) return filename;
    return `${filename}.ts`;
}

export async function loadDefaultVars(session: Session): Promise<void> {
    if (!fs.existsSync(DEFAULT_CONFIG_FILE)) {
        throw new Error(`Default vars file not found: ${DEFAULT_CONFIG_FILE}`);
    }
    await loadConfigFile(DEFAULT_CONFIG_FILE, session.runtime_env);
}