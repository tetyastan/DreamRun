import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { handleSocketMessage, initSocketSession } from './ws_gateway.js';

let wss: WebSocketServer | null = null;

/**
 * Attaches a WebSocket server to an existing HTTP server.
 *
 * Called once from the Vite plugin. The path is fixed at /api/game
 * so that client code has a single constant to point at. Any other
 * upgrade request is ignored, leaving the HTTP server to respond
 * with its default behaviour.
 */
export function attachGameSocket(httpServer: import('node:http').Server): void {
    if (wss) return;

    wss = new WebSocketServer({ noServer: true });

    httpServer.on('upgrade', (req: IncomingMessage, socket, head) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api/game')) {
            return;
        }

        wss!.handleUpgrade(req, socket, head, (ws) => {
            wss!.emit('connection', ws, req);
        });
    });

    wss.on('connection', (ws: WebSocket) => {
        // Each connection owns exactly one session. The session is
        // created eagerly so that the client gets a sessionId even
        // before it sends its first message.
        const state = initSocketSession(ws);

        ws.on('message', (raw) => {
            // Chain the handler onto the queue so handlers run sequentially.
            state._queue = state._queue.then(() =>
                handleSocketMessage(state, raw.toString())
            );
        });

        ws.on('close', () => {
            state.onClose();
        });

        ws.on('error', (err) => {
            console.error('[DreamRun][ws] socket error:', err);
        });
    });
}