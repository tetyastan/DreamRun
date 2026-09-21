import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SaveFile } from './save_types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.resolve(__dirname, '..', '..', '..', '.saves.json');

/**
 * In-memory per-user slot storage for server-side saves.
 *
 * Backed by a JSON file so that saves survive a dev-server restart.
 * In production this should be replaced with a database; the shape
 * of the functions below is what a real store would need to provide.
 */
type Store = Record<string, Record<number, SaveFile>>;

function loadStore(): Store {
    if (!fs.existsSync(STORE_PATH)) return {};
    try {
        return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8')) as Store;
    } catch {
        return {};
    }
}

function persist(store: Store): void {
    try {
        fs.writeFileSync(STORE_PATH, JSON.stringify(store), 'utf-8');
    } catch (e) {
        console.error('[DreamRun][saves] persist failed:', e);
    }
}

let store: Store = loadStore();

export function putSave(userId: string, slot: number, file: SaveFile): void {
    if (!store[userId]) store[userId] = {};
    store[userId][slot] = file;
    persist(store);
}

export function getSave(userId: string, slot: number): SaveFile | undefined {
    return store[userId]?.[slot];
}

export function listSaves(userId: string): Array<{ slot: number; metadata: SaveFile['metadata'] }> {
    const slots = store[userId];
    if (!slots) return [];
    return Object.entries(slots).map(([slot, file]) => ({
        slot: Number(slot),
        metadata: file.metadata,
    }));
}

export function deleteSave(userId: string, slot: number): void {
    if (!store[userId]) return;
    delete store[userId][slot];
    persist(store);
}