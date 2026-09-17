import type { Session } from './types.js';

export const SESSIONS = new Map<string, Session>();

export function createSession(initial: Session): string {
    const id = crypto.randomUUID();
    SESSIONS.set(id, initial);
    return id;
}

export function getSession(id: string): Session | undefined {
    return SESSIONS.get(id);
}

export function dropSession(id: string): void {
    SESSIONS.delete(id);
}