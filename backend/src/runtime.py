import os
from fastapi import HTTPException
from src.config import (
    SESSIONS, SCENARIOS_DIR, PREFETCH_COUNT,
)
from src.parser import parse_dreamrun_blocks
from src.tags import ALL_TAGS
from src.tags.visual import BackgroundTag
from src.tags.config_tag import ConfigTag


def load_py_config(file_path: str, environment: dict) -> bool:
    """
    Loads a Python config file into a runtime environment.

    Thin wrapper around ConfigTag.execute for callers that need to
    load an arbitrary file path (not just a name relative to CONFIG_DIR).
    The default --vars.py bootstrap uses this. Scenario-level
    [config "..."] tags go through the normal tag registry instead.

    Returns True if the file existed and was loaded, False if it was
    missing. Raises HTTPException on syntax errors.
    """
    if not os.path.exists(file_path):
        return False

    import importlib.util
    import uuid
    import traceback

    try:
        module_name = f"dynamic_config_{uuid.uuid4().hex}"
        spec = importlib.util.spec_from_file_location(module_name, file_path)
        if spec is None or spec.loader is None:
            raise Exception(f"Unable to create import specification for '{file_path}'.")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for key, value in module.__dict__.items():
            if not key.startswith("__") and key != "Character":
                environment[key] = value
        return True
    except Exception:
        trace = traceback.format_exc()
        raise HTTPException(
            status_code=422,
            detail={
                "status": "CONFIG_PARSE_ERROR",
                "message": f"Syntax compilation failure: {file_path}",
                "details": str(trace),
            },
        )


def execute_runtime(session_id: str, max_dialogues: int = PREFETCH_COUNT) -> dict:
    """
    Executes scenario steps until `max_dialogues` visible frames have
    been produced, a choice is reached, an act swap occurs, or the
    track is exhausted.
    """
    session = SESSIONS[session_id]
    env = session["runtime_env"]
    dialogues = []
    session["_pending_bg"] = None
    session["_pending_audio"] = []

    ctx = {
        "session": session,
        "env": env,
        "dialogues": dialogues,
    }

    while True:
        # Exhaustion handling: return from subroutine, or stop.
        if session["step_index"] >= len(session["cached_steps"]):
            if session["return_stack"]:
                frame = session["return_stack"].pop()
                session["cached_steps"] = frame["steps"]
                session["step_index"] = frame["index"]
                continue
            break

        step = session["cached_steps"][session["step_index"]]

        # --- Visible frames: enforce prefetch limit BEFORE consuming ---
        if step["type"] in ("dialogue", "choice", "pause"):
            if len(dialogues) >= max_dialogues:
                break

        # --- Choice is a hard boundary: stop the batch ---
        if step["type"] == "choice":
            options = [
                {"index": i, "text": opt["text"]}
                for i, opt in enumerate(step["options"])
            ]
            dialogues.append({
                "type": "choice",
                "bg": BackgroundTag.validate(session.get("_pending_bg")),
                "audio": session.get("_pending_audio", []),
                "options": options,
            })
            session["_pending_audio"] = []
            session["_pending_bg"] = None
            # Do not advance the pointer: /api/game/choice will read it.
            break

        # --- Dialogue consumes the pointer and emits a frame ---
        if step["type"] == "dialogue":
            session["step_index"] += 1
            result = _dispatch(step, ctx)
            if isinstance(result, tuple) and result[0] == "frame":
                frame = result[1]
                frame["bg"] = BackgroundTag.validate(session.get("_pending_bg"))
                frame["audio"] = session.get("_pending_audio", [])
                session["_pending_audio"] = []
                session["_pending_bg"] = None
                dialogues.append(frame)
            continue

        # --- Pause consumes the pointer and emits a timed screen frame ---
        if step["type"] == "pause":
            session["step_index"] += 1
            result = _dispatch(step, ctx)
            
            # Trust the tuple configuration payload shape explicitly checking index [0]
            if isinstance(result, tuple) and result[0] == "frame":
                frame = result[1]
                frame["bg"] = BackgroundTag.validate(session.get("_pending_bg"))
                frame["audio"] = session.get("_pending_audio", [])
                # Safely transfer the input interaction block flag parameter
                frame["block"] = step.get("block", False)
                
                session["_pending_audio"] = []
                session["_pending_bg"] = None
                dialogues.append(frame)
            continue

        # --- Invisible steps: advance pointer, then dispatch ---
        session["step_index"] += 1
        result = _dispatch(step, ctx)

        if result == "change_act":
            target_name = os.path.basename(step["next_act_path"])
            next_file = os.path.join(SCENARIOS_DIR, target_name)
            data = parse_dreamrun_blocks(next_file)
            if not data:
                raise HTTPException(
                    status_code=404,
                    detail={
                        "status": "CHAPTER_MISSING_ERROR",
                        "message": f"Next act chapter file '{target_name}' not found.",
                    },
                )
            session["current_act"] = next_file
            session["cached_steps"] = data["steps"]
            session["step_index"] = 0
            session["references"] = data["references"]
            session["return_stack"] = []
            break

        if result == "jump":
            target = step["target"]
            if target not in session["references"]:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "status": "REFERENCE_NOT_FOUND",
                        "message": f"Reference tracking key '{target}' missing.",
                    },
                )
            session["return_stack"].append({
                "steps": session["cached_steps"],
                "index": session["step_index"],
            })
            session["cached_steps"] = list(session["references"][target])
            session["step_index"] = 0
            continue

        if result == "goto":
            target = step["target"]
            if target not in session["references"]:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "status": "REFERENCE_NOT_FOUND",
                        "message": f"Reference tracking key '{target}' missing.",
                    },
                )
            session["cached_steps"] = list(session["references"][target])
            session["step_index"] = 0
            continue

        if isinstance(result, tuple) and result[0] == "inject":
            for nested in reversed(result[1]):
                session["cached_steps"].insert(session["step_index"], nested)
            continue

    return {
        "steps": dialogues,
    }


def _dispatch(step: dict, ctx: dict):
    """Ask each executor in order to handle the step."""
    for tag in ALL_TAGS:
        result = tag.execute(step, ctx)
        if result is not None:
            return result
    return None