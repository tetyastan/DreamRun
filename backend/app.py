import os
import uuid
import time
import traceback
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from src.core import Character
from src.config import SESSIONS, SCENARIOS_DIR, DEFAULT_VARS_FILE, INDEX_ACT, ASSETS_DIR
from src.models import ChoiceSelection
from src.parser import parse_dreamrun_blocks
from src.runtime import load_py_config, execute_runtime

# Minimum seconds between two /api/game/next calls from the same session.
# Prevents clients from burning through frames faster than a human can read.
MINIMUM_READ_TIME = 0.6

# Minimum seconds between two /api/game/choice calls from the same session.
# Set to 0 to disable. Soft enough not to punish quick players, but
# enough to discourage bots from probing all branches in one burst.
MINIMUM_CHOICE_DELAY = 0.1

app = FastAPI()

# CORS is fully permissive here for ease of local development.
# Tighten `allow_origins` before deploying to production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static asset mount. Any file under ASSETS_DIR is reachable at /assets/...
app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")


def _public_variables(session: dict) -> dict:
    """
    Extracts the public portion of the session environment.

    Hides the Character class itself and any other type objects so the
    client only receives plain data (scalars, characters, lists, dicts).
    """
    return {
        key: value for key, value in session["runtime_env"].items()
        if key != "Character" and not isinstance(value, type)
    }


@app.post("/api/game/start")
async def start_game():
    """
    Creates a fresh session and returns the first batch of frames.

    Response shape:
        {
            "session_id": "<uuid>",
            "steps": [ ...dialogue or choice frames... ],
            "variables": { ...public session env... }
        }
    """
    session_id = str(uuid.uuid4())
    first_act = os.path.join(SCENARIOS_DIR, INDEX_ACT)

    try:
        data = parse_dreamrun_blocks(first_act)
    except Exception as parse_err:
        raise HTTPException(
            status_code=400,
            detail={
                "status": "SYNTAX_COMPILATION_ERROR",
                "message": "Scenario script file contains syntax errors.",
                "details": str(parse_err),
            },
        )

    if not data:
        raise HTTPException(
            status_code=404,
            detail={
                "status": "ACT_MISSING_ERROR",
                "message": f"Entry file '{INDEX_ACT}' missing.",
            },
        )

    SESSIONS[session_id] = {
        "current_act": first_act,
        "cached_steps": data["steps"],
        "step_index": 0,
        "runtime_env": {"Character": Character},
        "references": data["references"],
        "return_stack": [],
        "last_request_time": 0,
        "last_choice_time": 0,
        "_pending_bg": None,
        "_pending_audio": [],
    }

    if not os.path.exists(DEFAULT_VARS_FILE):
        SESSIONS.pop(session_id, None)
        raise HTTPException(
            status_code=500,
            detail={
                "status": "CORE_CONFIG_MISSING",
                "message": "Global baseline system config is missing.",
            },
        )

    try:
        load_py_config(DEFAULT_VARS_FILE, SESSIONS[session_id]["runtime_env"])
    except Exception as e:
        error_trace = traceback.format_exc()
        SESSIONS.pop(session_id, None)
        raise HTTPException(
            status_code=500,
            detail={
                "status": "CORE_CONFIG_PARSE_ERROR",
                "message": "Baseline structural error.",
                "details": str(error_trace),
            },
        )

    result = execute_runtime(session_id)
    session = SESSIONS[session_id]

    return {
        "session_id": session_id,
        "steps": result["steps"],
        "variables": _public_variables(session),
    }


@app.post("/api/game/next")
async def next_scene(x_session_id: str = Header(None, alias="X-Session-ID")):
    """
    Advances the current session by one prefetch window.
    """
    if not x_session_id or x_session_id not in SESSIONS:
        raise HTTPException(
            status_code=401,
            detail={
                "status": "UNAUTHORIZED_SESSION",
                "message": "Session context invalid or expired.",
            },
        )

    session = SESSIONS[x_session_id]
    current_time = time.time()

    if session["last_request_time"] > 0:
        time_passed = current_time - session["last_request_time"]
        if time_passed < MINIMUM_READ_TIME:
            raise HTTPException(
                status_code=429,
                detail={
                    "status": "RATE_LIMIT_EXCEEDED",
                    "message": "Game state synchronization anomaly detected.",
                },
            )

    session["last_request_time"] = current_time
    result = execute_runtime(x_session_id)

    if not result["steps"]:
        return {
            "steps": [{"type": "game_end"}],
            "variables": _public_variables(session),
        }

    return {
        "steps": result["steps"],
        "variables": _public_variables(session),
    }


@app.post("/api/game/choice")
async def select_choice(
    payload: ChoiceSelection,
    x_session_id: str = Header(None, alias="X-Session-ID"),
):
    """
    Resolves a [choice] block by injecting the selected branch's steps
    ahead of the current pointer, then immediately resumes execution.

    Note: `execute_runtime` deliberately leaves `step_index` pointing
    AT the choice node when it returns a choice frame. So here we are
    still looking at the choice itself, not past it.
    """
    if not x_session_id or x_session_id not in SESSIONS:
        raise HTTPException(
            status_code=401,
            detail={
                "status": "UNAUTHORIZED_SESSION",
                "message": "Session expired.",
            },
        )

    session = SESSIONS[x_session_id]
    current_time = time.time()

    if MINIMUM_CHOICE_DELAY > 0 and session.get("last_choice_time", 0) > 0:
        since_last_choice = current_time - session["last_choice_time"]
        if since_last_choice < MINIMUM_CHOICE_DELAY:
            raise HTTPException(
                status_code=429,
                detail={
                    "status": "RATE_LIMIT_EXCEEDED",
                    "message": "Choice submissions are arriving too fast.",
                },
            )
    session["last_choice_time"] = current_time

    session["last_request_time"] = current_time

    if session["step_index"] >= len(session["cached_steps"]):
        raise HTTPException(
            status_code=400,
            detail={
                "status": "INVALID_STATE",
                "message": "No active choice found.",
            },
        )

    current_node = session["cached_steps"][session["step_index"]]
    if current_node["type"] != "choice":
        raise HTTPException(
            status_code=400,
            detail={
                "status": "INVALID_STATE",
                "message": "Pointer configuration mismatch.",
            },
        )

    if payload.choice_index < 0 or payload.choice_index >= len(current_node["options"]):
        raise HTTPException(
            status_code=420,
            detail={
                "status": "OUT_OF_BOUNDS",
                "message": "Selected choice out of scope.",
            },
        )

    chosen_option = current_node["options"][payload.choice_index]

    session["step_index"] += 1

    if chosen_option["type"] == "paired":
        for nested_step in reversed(chosen_option["branches"]):
            session["cached_steps"].insert(session["step_index"], nested_step)

    result = execute_runtime(x_session_id)

    return {
        "steps": result["steps"],
        "variables": _public_variables(session),
    }