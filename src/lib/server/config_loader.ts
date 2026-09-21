import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CONFIG_DIR, DEFAULT_CONFIG_FILE } from './config.js';
import type { Session } from './types.js';

/**
 * Loads a config file (.ts or .js) into the runtime env.
 *
 * The file is imported as an ES module. Every named export is merged
 * into `env`. The `default` export, if it is an object, is merged too.
 *
 * `Character` and `Ramp` are never overwritten: they are engine-owned
 * classes that must remain stable across config loads.
 */
export async function loadConfigFile(
    filename: string,
    env: Record<string, unknown>
): Promise<void> {
    const target = ensureExtension(filename);

    // Accept both absolute and relative paths. Relative paths are
    // resolved against CONFIG_DIR.
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
        if (key === 'Character') continue;
        if (key === 'Ramp') continue;
        env[key] = value;
    }

    // Support the pattern: export default { hero, merchant, ... }
    const defaultExport = (mod as { default?: unknown }).default;
    if (defaultExport && typeof defaultExport === 'object') {
        for (const [key, value] of Object.entries(defaultExport)) {
            if (key === 'Character') continue;
            if (key === 'Ramp') continue;
            env[key] = value;
        }
    }
}

/**
 * Appends `.ts` unless the filename already carries an extension.
 */
function ensureExtension(filename: string): string {
    if (filename.endsWith('.ts') || filename.endsWith('.js')) return filename;
    return `${filename}.ts`;
}

/**
 * Loads the global --vars.ts file into a freshly created session.
 * This runs once per session, on /api/start.
 */
export async function loadDefaultVars(session: Session): Promise<void> {
    if (!fs.existsSync(DEFAULT_CONFIG_FILE)) {
        throw new Error(`Default vars file not found: ${DEFAULT_CONFIG_FILE}`);
    }
    await loadConfigFile(DEFAULT_CONFIG_FILE, session.runtime_env);
}