import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Resolve the project root relative to this file. `config.ts` lives in
// src/lib/server/, so three levels up reach the project root.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

export const SCENES_DIR = path.join(PROJECT_ROOT, 'src', 'scenes');
export const ASSETS_DIR = path.join(PROJECT_ROOT, 'static', 'assets');

export const INDEX_ACT = 'index.dreamrun';

// Config files are loaded as ES modules. In development Vite transpiles
// them on the fly; in production they must be pre-compiled or the
// server must run under tsx.
export const CONFIG_DIR = path.join(PROJECT_ROOT, 'static', 'config');
export const DEFAULT_CONFIG_FILE = path.join(CONFIG_DIR, '--vars.ts');

export const REMOVE_QUOTATION_MARKS = true;

// Create the directories on first boot so that the engine can start
// even on a fresh checkout.
for (const dir of [SCENES_DIR, CONFIG_DIR, ASSETS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
}