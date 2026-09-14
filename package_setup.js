import fs from 'fs';
import readline from 'readline';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

function runCommand(cmd, dir = '.') {
    try {
        execSync(cmd, { cwd: dir, stdio: 'inherit' });
        return true;
    } catch (e) {
        console.error(`[Error] Failed to execute command: ${cmd} inside ${dir}`);
        return false;
    }
}

/**
 * Ensures frontend/node_modules exists and contains the runtime
 * tooling we need (concurrently). Runs npm install with cwd set to
 * the frontend directory so node_modules and package-lock.json are
 * created there, never at the repository root.
 */
function ensureFrontendDependencies(frontendDir) {
    const nodeModulesDir = path.join(frontendDir, 'node_modules');
    const concurrentlyBin = path.join(
        nodeModulesDir,
        'concurrently',
        'dist',
        'bin',
        'concurrently.js'
    );

    if (fs.existsSync(concurrentlyBin)) {
        return true;
    }

    console.log('[Msg] Installing frontend dependencies (npm install)...');

    const installed = runCommand('npm install', frontendDir);

    if (!installed) {
        console.error('[Error] npm install failed inside frontend/.');
        return false;
    }

    if (!fs.existsSync(concurrentlyBin)) {
        console.error('[Error] concurrently missing after npm install.');
        console.error('[Hint] Add "concurrently" to frontend/package.json devDependencies.');
        return false;
    }

    console.log('[Ok] Frontend dependencies installed.\n');
    return true;
}

async function main() {
    const DEFAULT_BACKEND_PORT = '8000';
    const DEFAULT_FRONTEND_PORT = '5173';
    const BACKEND_DIR = 'backend';
    const FRONTEND_DIR = 'frontend';
    const VENV_NAME = '.venv';

    const frontendEnvPath = path.join(FRONTEND_DIR, '.env');
    const venvDir = path.join(BACKEND_DIR, VENV_NAME);

    const isWindows = process.platform === 'win32';
    const pythonCmd = isWindows ? 'python' : 'python3';

    const venvBinDir = isWindows
        ? path.join(VENV_NAME, 'Scripts')
        : path.join(VENV_NAME, 'bin');

    const pythonVenvProxy = path.join(venvBinDir, 'python');

    let backendPort = DEFAULT_BACKEND_PORT;
    let frontendPort = DEFAULT_FRONTEND_PORT;
    let publicApiUrl = `http://127.0.0.1:${backendPort}`;
    let needEnvSetup = false;

    console.log('[Msg] DreamRun Engine: workspace setup');

    // ---- Version sync ----
    const rootPackagePath = 'package.json';
    const frontendPackagePath = path.join(FRONTEND_DIR, 'package.json');

    if (fs.existsSync(rootPackagePath) && fs.existsSync(frontendPackagePath)) {
        try {
            const rootData = JSON.parse(fs.readFileSync(rootPackagePath, 'utf-8'));
            const frontendData = JSON.parse(fs.readFileSync(frontendPackagePath, 'utf-8'));

            if (rootData.version && frontendData.version !== rootData.version) {
                console.log(`[Msg] Version mismatch. Syncing frontend to: ${rootData.version}`);
                frontendData.version = rootData.version;
                fs.writeFileSync(
                    frontendPackagePath,
                    JSON.stringify(frontendData, null, 2) + '\n',
                    'utf-8'
                );
                console.log('[Ok] Version fields synchronized.');
            }
        } catch (e) {
            console.warn('[Warn] Version synchronization skipped.');
        }
    }

    // ---- 1. Python venv ----
    if (!fs.existsSync(venvDir)) {
        console.log(`[Msg] Python venv (${VENV_NAME}) missing. Creating...`);
        const created = runCommand(`${pythonCmd} -m venv ${VENV_NAME}`, BACKEND_DIR);
        if (!created) {
            console.error('[Error] Python not installed or not in PATH.');
            process.exit(1);
        }
    }

    // ---- 2. Python dependencies ----
    const requirementsPath = path.join(BACKEND_DIR, 'requirements.txt');
    if (fs.existsSync(requirementsPath)) {
        console.log('[Msg] Installing backend Python dependencies...');
        runCommand(`${pythonVenvProxy} -m pip install --upgrade pip --quiet`, BACKEND_DIR);
        runCommand(`${pythonVenvProxy} -m pip install -r requirements.txt --quiet`, BACKEND_DIR);
        console.log('[Ok] Python dependencies installed.\n');
    } else {
        console.error('[Error] backend/requirements.txt not found.');
        process.exit(1);
    }

    // ---- 3. Frontend Node dependencies ----
    if (!ensureFrontendDependencies(FRONTEND_DIR)) {
        process.exit(1);
    }

    // ---- 4. Frontend .env ----
    if (!fs.existsSync(frontendEnvPath)) {
        needEnvSetup = true;
    } else {
        try {
            const envContent = fs.readFileSync(frontendEnvPath, 'utf-8');
            const match = envContent.match(/PUBLIC_API_URL=(.+)/);
            if (match) {
                publicApiUrl = match[1].trim();
                const portMatch = publicApiUrl.match(/:(\d+)/);
                if (portMatch) backendPort = portMatch[1];
            } else {
                needEnvSetup = true;
            }
        } catch {
            needEnvSetup = true;
        }
    }

    if (needEnvSetup) {
        console.log('[Msg] Missing environment fields. Starting interactive setup...');

        backendPort = await question(
            `[Field] Enter BACKEND dev port [default: ${DEFAULT_BACKEND_PORT}]: `
        ) || DEFAULT_BACKEND_PORT;

        frontendPort = await question(
            `[Field] Enter FRONTEND dev port [default: ${DEFAULT_FRONTEND_PORT}]: `
        ) || DEFAULT_FRONTEND_PORT;

        const defaultApiUrl = `http://127.0.0.1:${backendPort}`;
        publicApiUrl = await question(
            `[Field] Enter Backend PUBLIC_API_URL [default: ${defaultApiUrl}]: `
        ) || defaultApiUrl;

        try {
            fs.writeFileSync(
                frontendEnvPath,
                `PUBLIC_API_URL=${publicApiUrl}\n`,
                'utf-8'
            );
            console.log('\n[Ok] Frontend .env written.\n');
        } catch (err) {
            console.error('[Error] Failed to write frontend .env:', err.message);
            process.exit(1);
        }
    }

    rl.close();

    console.log('[Ok] Setup complete.');
    console.log('[Msg] Run "npm run dev" to launch the servers.');
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});