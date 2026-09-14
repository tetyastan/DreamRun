import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKEND_DIR = 'backend';
const FRONTEND_DIR = 'frontend';
const VENV_NAME = '.venv';

const isWindows = process.platform === 'win32';

function fail(message, hint) {
    console.error(`[Error] ${message}`);
    if (hint) console.error(`[Hint] ${hint}`);
    process.exit(1);
}

function requireFile(filePath, description, hint) {
    if (!fs.existsSync(filePath)) {
        fail(`${description} not found: ${filePath}`, hint);
    }
}

async function main() {
    console.log('[Msg] DreamRun Engine: launch');

    // ---- 1. Verify the workspace is ready ----

    const frontendEnvPath = path.join(FRONTEND_DIR, '.env');
    requireFile(
        frontendEnvPath,
        'frontend/.env',
        'Run "npm run setup" first.'
    );

    const envContent = fs.readFileSync(frontendEnvPath, 'utf-8');
    const match = envContent.match(/PUBLIC_API_URL=(.+)/);
    if (!match) {
        fail(
            'frontend/.env does not contain PUBLIC_API_URL.',
            'Delete frontend/.env and run "npm run setup" again.'
        );
    }
    const publicApiUrl = match[1].trim();

    const portMatch = publicApiUrl.match(/:(\d+)/);
    const backendPort = portMatch ? portMatch[1] : '8000';

    // Allow --port to override the frontend port at launch time.
    const portArgIdx = process.argv.indexOf('--port');
    const frontendPort = (portArgIdx !== -1 && process.argv[portArgIdx + 1])
        ? process.argv[portArgIdx + 1]
        : '5173';

    const venvBinDir = isWindows
        ? path.join(BACKEND_DIR, VENV_NAME, 'Scripts')
        : path.join(BACKEND_DIR, VENV_NAME, 'bin');

    if (!fs.existsSync(venvBinDir)) {
        fail(
            `Python venv not found: ${venvBinDir}`,
            'Run "npm run setup" first.'
        );
    }

    const concurrentlyBin = path.join(
        FRONTEND_DIR,
        'node_modules',
        'concurrently',
        'dist',
        'bin',
        'concurrently.js'
    );

    if (!fs.existsSync(concurrentlyBin)) {
        fail(
            `concurrently not found: ${concurrentlyBin}`,
            'Run "npm run setup" first.'
        );
    }

    // ---- 2. Launch ----

    const pythonExeName = isWindows ? 'python.exe' : 'python';
    const backendCommand = isWindows
        ? `cd ${BACKEND_DIR} && .\\${VENV_NAME}\\Scripts\\${pythonExeName} -m uvicorn app:app --host 127.0.0.1 --port ${backendPort} --reload`
        : `cd ${BACKEND_DIR} && ./${VENV_NAME}/bin/${pythonExeName} -m uvicorn app:app --host 127.0.0.1 --port ${backendPort} --reload`;

    const frontendCommand = `cd ${FRONTEND_DIR} && npm run dev -- --port ${frontendPort}`;

    const spawnArgs = [
        concurrentlyBin,
        '--kill-others',
        '-n', 'Backend,Frontend',
        '-c', 'cyan,magenta',
        backendCommand,
        frontendCommand
    ];

    console.log('[Msg] Servers starting...');

    const child = spawn(process.execPath, spawnArgs, {
        stdio: 'inherit',
        cwd: __dirname
    });

    // ---- 3. Terminal cleanup ----

    const restoreTerminal = () => {
        process.stdout.write('\x1B[?25h');
        if (process.stdin.setRawMode) {
            process.stdin.setRawMode(false);
        }
    };

    const shutdown = (signal) => {
        restoreTerminal();
        if (child && !child.killed) {
            try {
                child.kill(signal || 'SIGTERM');
            } catch {}
        }
    };

    process.on('SIGINT', () => {
        shutdown('SIGINT');
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        shutdown('SIGTERM');
        process.exit(0);
    });

    process.on('exit', () => {
        restoreTerminal();
    });

    child.on('exit', (code) => {
        restoreTerminal();
        process.exit(code ?? 0);
    });
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});