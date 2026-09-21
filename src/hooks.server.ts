import type { Handle } from '@sveltejs/kit';
import { attachGameSocket } from '$lib/server/ws_gateway.js';

/**
 * Standard SvelteKit request hook.
 *
 * The WebSocket gateway is attached elsewhere — see `ws_bootstrap.ts`
 * — because SvelteKit's dev server does not surface the underlying
 * HTTP server through the request event in a stable way. This hook is
 * a placeholder for whatever request-level logic the app needs; the
 * socket upgrade is handled separately.
 */
export const handle: Handle = async ({ event, resolve }) => {
    return resolve(event);
};