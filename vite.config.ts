import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type ViteDevServer } from 'vite';

function gameSocketPlugin() {
    return {
        name: 'dreamrun-game-socket',
        async configureServer(server: ViteDevServer) {
            if (!server.httpServer) return;

            // Imported lazily so that vite.config.ts itself has no
            // dependency on $lib-aliased code. By the time this hook
            // runs, SvelteKit has already registered its resolver and
            // the gateway's own imports will resolve correctly.
            const { attachGameSocket } = await server.ssrLoadModule(
                '/src/lib/server/ws_bootstrap.ts'
            );
            attachGameSocket(server.httpServer);
        },
    };
}

export default defineConfig({
    plugins: [sveltekit(), gameSocketPlugin()],
});