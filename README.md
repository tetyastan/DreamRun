# DreamRun

A visual novel engine built on FastAPI (backend) and Svelte 5 (frontend).  
Scenarios are written in `.dreamrun` files, a custom line-based scripting language with
Python execution, conditional branching, subroutines, choices, layered sprites, and
sample-accurate audio ramps.

This document covers **build and setup only**. For full engine documentation, see the
project Wiki.

---

## Requirements

| Component | Minimum | Notes |
|---|---|---|
| Python    | 3.10    | 3.11+ recommended for `cancelAndHoldAtTime` support in browsers |
| Node.js   | 18.x    | 20.x recommended |
| npm       | 9.x     | ships with Node 18+ |
| OS        | Windows, Linux, macOS | tested on Windows 10/11, Debian 12, macOS 14 |

It is important to note that, in accordance with the engine's development standards, **all recommendations must be followed to avoid interfering with DreamRun scenarios execution!**

---

## Quick Start

From the repository root:

```bash
# Prepare the workspace (run once, or after changing dependencies)
npm run setup
# Launch the servers
npm run dev
```

`npm run setup` prepares the workspace. It is idempotent: running it again only checks what is already in place.
`npm run dev` requires a prepared workspace and will refuse to launch otherwise.

The `setup` script performs a full first-run bootstrap:

1. Synchronises the version field between the root and `frontend/package.json`.
2. Creates `backend/.venv` if it does not exist.
3. Installs Python dependencies from `backend/requirements.txt`.
4. Installs frontend dependencies into `frontend/node_modules`.
5. Creates `frontend/.env` interactively if missing.
6. Launches both servers via `concurrently`.

If `frontend/.env` is missing or does not contain `PUBLIC_API_URL`, the script asks three questions:

```bash
[Field] Enter BACKEND dev port [default: 8000]:
[Field] Enter FRONTEND dev port [default: 5173]:
[Field] Enter Backend PUBLIC_API_URL [default: http://127.0.0.1:8000]:
```

Press Enter to accept the defaults.

---

## Manual Setup
If you prefer to run each part by hand, or the automated script fails on your platform.

### 1. Backend
```bash
cd backend
python -m venv .venv
```

### Activate the venv:

#### Windows (PowerShell): `.\.venv\Scripts\Activate.ps1`
#### Windows (cmd): `.\.venv\Scripts\activate.bat`
#### Linux / macOS: `source .venv/bin/activate`

### Install dependencies:

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

### Run the development server:

```bash
uvicorn app:app --host 127.0.0.1 --port 8000 --reload
```

### 2. Frontend

```bash
cd frontend
npm install
```

#### Create frontend/.env manually:

```
PUBLIC_API_URL=http://127.0.0.1:8000
```

#### Run the dev server: `npm run dev -- --port 5173`

---

## Production Notes

DreamRun is an engine designed to operate within a closed environment to ensure full functionality of its online features. Before deployment:

*   **Configure CORS.** Currently, `app.py` is set to `allow_origins=["*"]`. Replace this value with an explicit list of hosts used in production.

*   **Replace in-memory session storage.** In the template's default state, the `SESSIONS` variable in `config.py` is a standard Python dictionary. Consequently, all active game sessions are lost whenever the server restarts. Use Redis or a database instead.

*   **Adjust rate-limiting settings.** The `MINIMUM_READ_TIME` and `MINIMUM_CHOICE_DELAY` parameters are configured for local development and may not behave as intended in a real-world scenario; adjust them based on your network's characteristics.

*   **Build the frontend.** Running `npm run build` in the `frontend/` directory creates a static bundle in `frontend/build/`. Serve this bundle using a static web server (e.g., Nginx, Caddy, or S3 + CloudFront).

*   **Optimize static asset delivery.** While `StaticFiles` is convenient, it performs poorly under heavy load. In production, place Nginx or a CDN in front of it.

*   **Use HTTPS (SSL).** Browser AudioContext APIs require a secure connection (secure context) when running outside of `localhost`.

*   **Consider using a sandbox (isolation).** Code marked with the `[python]` tag executes with full server privileges. For production, it is highly recommended to isolate the project in a separate environment! Docker or a dedicated system user for the project are excellent options for this.