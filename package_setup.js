import fs from 'fs';
import readline from 'readline';
import path from 'path';
import { spawn, execSync } from 'child_process';

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

async function main() {
    // Config constants
    const DEFAULT_BACKEND_PORT = '8000';
    const DEFAULT_FRONTEND_PORT = '5173';
    const BACKEND_DIR = 'backend';
    const FRONTEND_DIR = 'frontend';
    const VENV_NAME = '.venv';
    
    const frontendEnvPath = path.join(FRONTEND_DIR, '.env');
    const venvDir = path.join(BACKEND_DIR, VENV_NAME);
    
    const isWindows = process.platform === 'win32';
    const pythonCmd = isWindows ? 'python' : 'python3';
    
    const venvBinDir = isWindows ? path.join(VENV_NAME, 'Scripts') : path.join(VENV_NAME, 'bin');
    const pipCmd = path.join(venvBinDir, 'pip');
    const pythonVenvProxy = path.join(venvBinDir, 'python');

    let backendPort = DEFAULT_BACKEND_PORT;
    let frontendPort = DEFAULT_FRONTEND_PORT;
    let publicApiUrl = `http://127.0.0.1:${backendPort}`;
    let needSetup = false;

    console.log('[Msg] DreamRun Engine: Your First Setup');

    // Automatically copies the master version from root into frontend packaging
    const rootPackagePath = 'package.json';
    const frontendPackagePath = path.join(FRONTEND_DIR, 'package.json');

    if (fs.existsSync(rootPackagePath) && fs.existsSync(frontendPackagePath)) {
        try {
            const rootData = JSON.parse(fs.readFileSync(rootPackagePath, 'utf-8'));
            const frontendData = JSON.parse(fs.readFileSync(frontendPackagePath, 'utf-8'));
            
            if (rootData.version && frontendData.version !== rootData.version) {
                console.log(`[Msg] Version mismatch detected. Syncing frontend packaging to master version: ${rootData.version}`);
                frontendData.version = rootData.version;
                fs.writeFileSync(frontendPackagePath, JSON.stringify(frontendData, null, 2) + '\n', 'utf-8');
                console.log('[Ok] Version fields synchronized successfully.');
            }
        } catch (e) {
            console.warn('[Warn] Version synchronization matrix skipped due to a malformed package.json descriptor.');
        }
    }

    // 1. Python VENV Auto-Hydration Pipeline
    if (!fs.existsSync(venvDir)) {
        console.log(`[Msg] Python virtual environment (${VENV_NAME}) missing. Initializing...`);
        const venvCreated = runCommand(`${pythonCmd} -m venv ${VENV_NAME}`, BACKEND_DIR);
        if (!venvCreated) {
            console.error('[Error] Python is not installed or not added to system PATH variables.');
            process.exit(1);
        }
    }

    const requirementsPath = path.join(BACKEND_DIR, 'requirements.txt');
    if (fs.existsSync(requirementsPath)) {
        console.log('[Msg] Resolving backend python dependencies mapping states...');
        runCommand(`${pythonVenvProxy} -m pip install --upgrade pip --quiet`, BACKEND_DIR);
        runCommand(`${pipCmd} install -r requirements.txt --quiet`, BACKEND_DIR);
        console.log('[Ok] Python dependencies configuration synced.\n');
    }

    // 2. Silent env diagnostics hook
    if (!fs.existsSync(frontendEnvPath)) {
        needSetup = true;
    } else {
        try {
            const envContent = fs.readFileSync(frontendEnvPath, 'utf-8');
            const match = envContent.match(/PUBLIC_API_URL=(.+)/);
            if (match) {
                publicApiUrl = match[1].trim();
                const portMatch = publicApiUrl.match(/:(\d+)/);
                if (portMatch) backendPort = portMatch[1];
            }
        } catch (e) {
            needSetup = true;
        }
    }

    if (needSetup) {
        console.log('[Msg] Missing environment fields detected. Starting setup...');

        backendPort = await question(`[Field] Enter BACKEND dev port [default: ${DEFAULT_BACKEND_PORT}]: `) || DEFAULT_BACKEND_PORT;
        frontendPort = await question(`[Field] Enter FRONTEND dev port [default: ${DEFAULT_FRONTEND_PORT}]: `) || DEFAULT_FRONTEND_PORT;
        
        const defaultApiUrl = `http://127.0.0.1:${backendPort}`;
        publicApiUrl = await question(`[Field] Enter Backend PUBLIC_API_URL [default: ${defaultApiUrl}]: `) || defaultApiUrl;

        try {
            fs.writeFileSync(frontendEnvPath, `PUBLIC_API_URL=${publicApiUrl}\n`, 'utf-8');
            console.log(`\n[Ok] Frontend '.env' file cleanly flushed to disk.`);
        } catch (err) {
            console.error(`[Error] Failed to write frontend .env file:`, err.message);
            process.exit(1);
        }
    }

    rl.close();

    const isPostInstall = process.env.npm_lifecycle_event === 'postinstall';
    if (isPostInstall) {
        console.log('[Msg] Initialization complete! All dependencies installed.');
        console.log('[Msg] To launch the development servers, run:');
        console.log('[Msg] npm run dev');
        process.exit(0);
    }

    // 3. Execution parameters injection
    console.log(`[Msg] Launching architecture processes logs console...`);
    
    // Cleaned commands of system redirects. Vite customLogger inside vite.config.ts handles file logging now.
    // Also fixed Uvicorn module path to target 'app:app' securely.
    const backendRunCmd = isWindows
        ? `cd ${BACKEND_DIR} && .\\${VENV_NAME}\\Scripts\\uvicorn app:app --host 127.0.0.1 --port ${backendPort} --reload`
        : `cd ${BACKEND_DIR} && source ${venvBinDir}/activate && uvicorn app:app --host 127.0.0.1 --port ${backendPort} --reload`;

    const frontendRunCmd = `cd ${FRONTEND_DIR} && npm run dev -- --port ${frontendPort}`;

    // Resolve the direct absolute path to concurrently's JS entrypoint inside node_modules.
    // This bypasses npx.cmd/cmd.exe wrapping layers on Windows, preventing the "Terminate batch job?" prompt.
    const concurrentlyBin = path.join('node_modules', 'concurrently', 'dist', 'bin', 'concurrently.js');

    const spawnArgs = [
        concurrentlyBin,
        '--kill-others',
        '-n', 'Backend,Frontend',
        '-c', 'cyan,magenta',
        backendRunCmd,
        frontendRunCmd
    ];

    // Spawn via direct node execution context instead of system shell scripts wrappers
    const child = spawn(process.execPath, spawnArgs, { stdio: 'inherit' });

    // Terminal Cleanup Pipeline Handler
    const safeCleanupAndExit = (signal) => {
        process.stdout.write('\x1B[?25h');
        
        if (child && !child.killed) {
            child.kill(signal || 'SIGTERM');
        }
        
        if (process.stdin.setRawMode) {
            process.stdin.setRawMode(false);
        }
        
        process.exit(0);
    };

    process.on('SIGINT', () => safeCleanupAndExit('SIGINT'));
    process.on('SIGTERM', () => safeCleanupAndExit('SIGTERM'));
    process.on('exit', () => safeCleanupAndExit(0));

    if (child) {
        child.on('exit', (code) => {
            safeCleanupAndExit(code);
        });
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
