import importlib.util
import os
import uuid
import traceback
from fastapi import HTTPException
from src.core import Character
from src.config import SESSIONS, ASSETS_DIR, SCENARIOS_DIR, CONFIG_DIR, PREFETCH_COUNT
from src.parser import parse_dreamrun_blocks


def load_py_config(file_path: str, environment: dict) -> bool:
    """
    Loads a Python configuration file into a scenario runtime environment.

    Every public attribute defined in the module is copied into the
    session environment so that scripts and dialogue templates can
    reference it directly.

    Safety notes:
        - The module is executed with full Python privileges; only load
          trusted files. Do not point this at user-uploaded content.
        - `Character` is preserved: a config file cannot shadow the
          engine's Character class.
    """
    if not os.path.exists(file_path):
        return False
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
    except Exception as e:
        raise e


def execute_runtime(session_id: str, max_dialogues: int = PREFETCH_COUNT) -> list:
    """
    Processes server-side scenario execution pipelines using subroutine stack frames.

    `max_dialogues` limits only the number of visible frames
    (dialogue or choice) returned in the batch.
    
    Invisible steps (python_exec, cfg_import, bg, pass, jump,
    goto, conditional_block) are executed unconditionally and
    never count against the limit.
    
    The loop stops before executing a step that would produce a
    visible frame if the batch is already full. This keeps the
    session pointer right at that step, so the next call resumes
    exactly from there.
    
    change_act stops the batch immediately after swapping the
    act, because the next act must begin on a fresh request.
    """
    session = SESSIONS[session_id]
    env = session["runtime_env"]
    dialogues = []
    pending_bg = None

    while True:
        # Exhaustion handling
        if session["step_index"] >= len(session["cached_steps"]):
            if session["return_stack"]:
                frame = session["return_stack"].pop()
                session["cached_steps"] = frame["steps"]
                session["step_index"] = frame["index"]
                continue
            # Nothing left in the current track.
            break

        step = session["cached_steps"][session["step_index"]]

        # Visible frame types: check the limit before consuming
        if step["type"] == "choice":
            if len(dialogues) >= max_dialogues:
                # Batch is full. Leave step_index on the choice so the next call picks it up.
                break

            # --- VALIDATE BACKGROUND ASSET FOR CHOICE NODE ---
            final_choice_bg = pending_bg
            if pending_bg:
                relative_path = pending_bg.replace("/assets/", "")
                absolute_asset_path = os.path.join(ASSETS_DIR, relative_path)
                if not os.path.exists(absolute_asset_path):
                    final_choice_bg = f"MISSING:{os.path.basename(pending_bg)}"

            # Build the choice frame.
            options_payload = []
            for idx, opt in enumerate(step["options"]):
                options_payload.append({"index": idx, "text": opt["text"]})
            dialogues.append({
                "type": "choice",
                "bg": final_choice_bg,
                "options": options_payload
            })
            # Do NOT advance step_index — choice must be re-visited by
            # /api/game/choice to know which branch to inject.
            break

        if step["type"] == "audio":
            audio_command = {
                "modifier": step["modifier"],
                "id": step["id"]
            }
            
            # File validation layer for new entries
            if step["modifier"] in ("sound", "music"):
                path_value = step["path"]
                if path_value.startswith("/assets/"):
                    relative_path = path_value.replace("/assets/", "")
                    absolute_asset_path = os.path.join(ASSETS_DIR, relative_path)
                    
                    # Validate asset existence on server hard drive disk
                    if not os.path.exists(absolute_asset_path):
                        path_value = f"MISSING:{os.path.basename(step['path'])}"
                
                audio_command.update({
                    "path": path_value,
                    "volume": step["volume"],
                    "pitch": step["pitch"]
                })
            
            elif step["modifier"] == "modify":
                audio_command.update({
                    "volume": step["volume"],
                    "pitch": step["pitch"]
                })

            session["pending_audio"].append(audio_command)
            continue

        if step["type"] == "dialogue":
            if len(dialogues) >= max_dialogues:
                # Batch is full. Leave step_index on this dialogue so the next call resumes exactly here.
                break
            # Consume the dialogue.
            session["step_index"] += 1

            name = None
            if step["speaker_mode"] == "variable":
                var_key = step["key"]
                if var_key in env and isinstance(env[var_key], Character):
                    name = env[var_key].name
                else:
                    name = var_key
            elif step["speaker_mode"] == "literal":
                name = step["name"]

            text = step["text"]
            if text:
                try:
                    formatting_map = {key: value for key, value in env.items()}
                    text = text.format(**formatting_map)
                except Exception:
                    pass

            # --- VALIDATE BACKGROUND ASSET FOR DIALOGUE NODE ---
            final_dialogue_bg = pending_bg
            if pending_bg:
                relative_path = pending_bg.replace("/assets/", "")
                absolute_asset_path = os.path.join(ASSETS_DIR, relative_path)
                if not os.path.exists(absolute_asset_path):
                    final_dialogue_bg = f"MISSING:{os.path.basename(pending_bg)}"

            dialogues.append({
                "type": "dialogue",
                "name": name,
                "text": text,
                "bg": final_dialogue_bg
            })
            pending_bg = None
            continue

        # Invisible steps? Always execute, never count against limit
        # Advance the pointer for all non-choice, non-dialogue steps.
        session["step_index"] += 1

        if step["type"] == "pass":
            continue

        if step["type"] == "change_act":
            target_file_name = os.path.basename(step["next_act_path"])
            next_file = os.path.join(SCENARIOS_DIR, target_file_name)
            data = parse_dreamrun_blocks(next_file)

            if not data:
                raise HTTPException(
                    status_code=404,
                    detail={
                        "status": "CHAPTER_MISSING_ERROR",
                        "message": f"Next act chapter file '{target_file_name}' not found."
                    }
                )

            session["current_act"] = next_file
            session["cached_steps"] = data["steps"]
            session["step_index"] = 0
            session["references"] = data["references"]
            session["return_stack"] = []
            # Act swap must end the batch cleanly.
            break

        if step["type"] == "jump":
            target_ref = step["target"]
            if target_ref not in session["references"]:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "status": "REFERENCE_NOT_FOUND",
                        "message": f"Reference tracking key '{target_ref}' missing."
                    }
                )
            session["return_stack"].append({
                "steps": session["cached_steps"],
                "index": session["step_index"]
            })
            session["cached_steps"] = list(session["references"][target_ref])
            session["step_index"] = 0
            continue

        if step["type"] == "goto":
            target_ref = step["target"]
            if target_ref not in session["references"]:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "status": "REFERENCE_NOT_FOUND",
                        "message": f"Reference tracking key '{target_ref}' missing."
                    }
                )
            session["cached_steps"] = list(session["references"][target_ref])
            session["step_index"] = 0
            continue

        if step["type"] == "python_exec":
            try:
                exec(step["code"], {}, env)
            except Exception:
                error_trace = traceback.format_exc()
                raise HTTPException(
                    status_code=422,
                    detail={
                        "status": "SCRIPT_RUNTIME_ERROR",
                        "message": "Python step failed.",
                        "details": f"Code:\n{step['code']}\n\nTrace:\n{error_trace}"
                    }
                )
            continue

        if step["type"] == "cfg_import":
            cfg_path = os.path.join(CONFIG_DIR, step["filename"])
            if not os.path.exists(cfg_path):
                raise HTTPException(
                    status_code=404,
                    detail={
                        "status": "CONFIG_MISSING_ERROR",
                        "message": f"Asset missing: {step['filename']}"
                    }
                )
            try:
                load_py_config(cfg_path, env)
            except Exception:
                error_trace = traceback.format_exc()
                raise HTTPException(
                    status_code=422,
                    detail={
                        "status": "CONFIG_PARSE_ERROR",
                        "message": "Syntax compilation failure.",
                        "details": str(error_trace)
                    }
                )
            continue

        if step["type"] == "conditional_block":
            for branch in step["branches"]:
                if branch["mode"] in ("if", "elif"):
                    try:
                        condition_result = bool(eval(branch["condition"], {}, env))
                    except Exception as eval_err:
                        raise HTTPException(
                            status_code=422,
                            detail={
                                "status": "CONDITIONAL_EVAL_ERROR",
                                "message": f"Failed to evaluate condition: {branch['condition']}",
                                "details": str(eval_err)
                            }
                        )
                else:
                    condition_result = True

                if condition_result:
                    for nested_step in reversed(branch["steps"]):
                        session["cached_steps"].insert(session["step_index"], nested_step)
                    break
            continue

        if step["type"] == "bg":
            pending_bg = step["value"]
            continue

    return dialogues