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


@app.post("/api/game/start")
async def start_game():
    """
    Creates a fresh session and returns the first batch of frames.

    Response shape:
        {
            "session_id": "<uuid>",
            "steps": [ ...dialogue or smth... ],
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
                "details": str(parse_err)
            }
        )

    if not data:
        raise HTTPException(
            status_code=404,
            detail={"status": "ACT_MISSING_ERROR", "message": f"Entry file '{INDEX_ACT}' missing."}
        )

    SESSIONS[session_id] = {
        "current_act": first_act,
        "cached_steps": data["steps"],
        "step_index": 0,
        "runtime_env": {"Character": Character},
        "references": data["references"],
        "return_stack": [],          # Stack of saved frames for [jump] calls
        "last_request_time": 0       # Populated on first /next call
    }

    if not os.path.exists(DEFAULT_VARS_FILE):
        SESSIONS.pop(session_id, None)
        raise HTTPException(
            status_code=500,
            detail={"status": "CORE_CONFIG_MISSING", "message": "Global baseline system config is missing."}
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
                "details": str(error_trace)
            }
        )

    first_payload_steps = execute_runtime(session_id)
    session = SESSIONS[session_id]

    return {
        "session_id": session_id,
        "steps": first_payload_steps,
        "variables": {
            key: value for key, value in session["runtime_env"].items()
            if key != "Character" and not isinstance(value, type)
        }
    }


@app.post("/api/game/next")
async def next_scene(x_session_id: str = Header(None, alias="X-Session-ID")):
    """
    Advances the current session by one prefetch window.

    The session id must be supplied via the `X-Session-ID` header.
    A small rate limit prevents clients from burning through frames
    faster than a human can read them.
    """
    if not x_session_id or x_session_id not in SESSIONS:
        raise HTTPException(
            status_code=401,
            detail={"status": "UNAUTHORIZED_SESSION", "message": "Session context invalid or expired."}
        )

    session = SESSIONS[x_session_id]
    current_time = time.time()

    # Rate limit: reject requests that arrive suspiciously fast.
    if session["last_request_time"] > 0:
        time_passed = current_time - session["last_request_time"]
        MINIMUM_READ_TIME = 0.2
        if time_passed < MINIMUM_READ_TIME:
            raise HTTPException(
                status_code=429,
                detail={
                    "status": "RATE_LIMIT_EXCEEDED",
                    "message": "Game state synchronization anomaly detected."
                }
            )

    session["last_request_time"] = current_time
    steps = execute_runtime(x_session_id)

    # Empty batch equals nothing left in the scenario.
    # The client interprets "game_end" as a return to the main menu.
    if not steps:
        return {
            "steps": [{"type": "game_end"}],
            "variables": {
                key: value for key, value in session["runtime_env"].items()
                if key != "Character" and not isinstance(value, type)
            }
        }

    return {
        "steps": steps,
        "variables": {
            key: value for key, value in session["runtime_env"].items()
            if key != "Character" and not isinstance(value, type)
        }
    }


@app.post("/api/game/choice")
async def select_choice(
    payload: ChoiceSelection,
    x_session_id: str = Header(None, alias="X-Session-ID")
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
            detail={"status": "UNAUTHORIZED_SESSION", "message": "Session expired."}
        )

    session = SESSIONS[x_session_id]

    if session["step_index"] >= len(session["cached_steps"]):
        raise HTTPException(
            status_code=400,
            detail={"status": "INVALID_STATE", "message": "No active choice found."}
        )

    current_node = session["cached_steps"][session["step_index"]]
    if current_node["type"] != "choice":
        raise HTTPException(
            status_code=400,
            detail={"status": "INVALID_STATE", "message": "Pointer configuration mismatch."}
        )

    if payload.choice_index < 0 or payload.choice_index >= len(current_node["options"]):
        raise HTTPException(
            status_code=420,
            detail={"status": "OUT_OF_BOUNDS", "message": "Selected choice out of scope."}
        )

    chosen_option = current_node["options"][payload.choice_index]

    # Advance past the choice node — the player has made a decision.
    session["step_index"] += 1

    if chosen_option["type"] == "paired":
        for nested_step in reversed(chosen_option["branches"]):
            session["cached_steps"].insert(session["step_index"], nested_step)

    steps = execute_runtime(x_session_id)

    return {
        "steps": steps,
        "variables": {
            key: value for key, value in session["runtime_env"].items()
            if key != "Character" and not isinstance(value, type)
        }
    }