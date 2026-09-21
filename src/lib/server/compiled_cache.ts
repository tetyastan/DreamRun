import { compileScript, type CompiledScript } from './compiler.js';

/**
 * Cache of compiled scenarios, keyed by source hash.
 *
 * In development the same scenario is compiled once per server
 * process; subsequent sessions reuse the cached graph. When the
 * source files change, the hash changes and a fresh compilation
 * replaces the cached entry.
 *
 * In production this could be persisted to disk or to a database,
 * but for a single-process dev server an in-memory map is enough.
 */
const cache = new Map<string, CompiledScript>();

/**
 * Returns a compiled script for the given entry act, compiling it
 * on first use and reusing the cached copy afterwards.
 *
 * The cache key is the source hash, computed by the compiler from
 * every file it visits. If a file changes, the hash changes, and
 * the next call recompiles.
 */
export function getCompiledScript(entryAct?: string): CompiledScript {
    // Compile once to learn the current source hash. If the cache
    // already has that hash, we discard the freshly compiled result
    // and return the cached one — same content, less memory.
    //
    // An alternative is to hash the source files up-front, but that
    // would require walking the act graph outside the compiler. The
    // double work here is negligible and keeps the API small.
    const fresh = compileScript(entryAct);

    const cached = cache.get(fresh.source_hash);
    if (cached) return cached;

    cache.set(fresh.source_hash, fresh);

    // Keep the cache from growing without bound when the scenario
    // is edited repeatedly during a session.
    if (cache.size > 8) {
        const firstKey = cache.keys().next().value;
        if (firstKey !== undefined) cache.delete(firstKey);
    }

    return fresh;
}

/**
 * Drops every cached compilation. Called when the user explicitly
 * asks for a reload, or after a scenario edit that the file watcher
 * has already seen.
 */
export function clearCompiledCache(): void {
    cache.clear();
}