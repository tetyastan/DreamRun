import type { Session } from './types.js';

/**
 * In-memory session storage.
 *
 * In production this should be replaced with Redis or a database so
 * that sessions survive server restarts and can be shared across
 * multiple processes.
 */
export const SESSIONS = new Map<string, Session>();

// A session that has not received a request for this long is evicted.
const SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * Allocates a new UUID, stores the session, and returns the id.
 */
export function createSession(initial: Session): string {
    const id = crypto.randomUUID();
    SESSIONS.set(id, initial);
    return id;
}

/**
 * Returns the session and refreshes its last_request_time, which the
 * garbage collector uses to decide whether the session is still live.
 */
export function getSession(id: string): Session | undefined {
    const session = SESSIONS.get(id);
    if (session) session.last_request_time = Date.now();
    return session;
}

export function dropSession(id: string): void {
    SESSIONS.delete(id);
}

// Background cleanup. Runs once every 30 seconds and removes any
// session whose last request was longer than SESSION_TTL_MS ago.
if (typeof globalThis !== 'undefined') {
    setInterval(() => {
        const nowMs = Date.now();
        for (const [id, session] of SESSIONS.entries()) {
            const lastActiveMs = session.last_request_time || nowMs;
            if (nowMs - lastActiveMs > SESSION_TTL_MS) {
                SESSIONS.delete(id);
                console.log(`[DreamRun][GC] Evicted expired session: ${id}`);
            }
        }
    }, 30 * 1000);
}