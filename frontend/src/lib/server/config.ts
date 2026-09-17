import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Project root: three levels up from src/lib/server/
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

export const SCENES_DIR = path.join(PROJECT_ROOT, 'src', 'scenes');
export const CONFIG_DIR = path.join(PROJECT_ROOT, 'src', 'config');
export const ASSETS_DIR = path.join(PROJECT_ROOT, 'static', 'assets');

export const INDEX_ACT = 'index.dreamrun';
export const DEFAULT_VARS_FILE = path.join(PROJECT_ROOT, 'src', 'scenes', '--vars.ts');

export const REMOVE_QUOTATION_MARKS = true;
export const PREFETCH_COUNT = 5;

// Ensure folders exist
for (const dir of [SCENES_DIR, CONFIG_DIR, ASSETS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
}