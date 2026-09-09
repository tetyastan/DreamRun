from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import importlib.util
import os
import re
import uuid
import time
import traceback

from core import Character

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SCENARIOS_DIR = os.path.join(os.path.dirname(__file__), "acts")
CONFIG_DIR = os.path.join(os.path.dirname(__file__), "config")
ASSETS_DIR = os.path.join(os.path.dirname(__file__), "assets")
INDEX_ACT = "index.dreamrun"
DEFAULT_VARS_FILE = os.path.join(CONFIG_DIR, "--vars.py")
REMOVE_QUOTATION_MARKS = True

PREFETCH_COUNT = 3

os.makedirs(ASSETS_DIR, exist_ok=True)
os.makedirs(CONFIG_DIR, exist_ok=True)
os.makedirs(SCENARIOS_DIR, exist_ok=True)

app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")

SESSIONS = {}


class ChoiceSelection(BaseModel):
    choice_index: int


def clean_dialogue_text(text: str) -> str:
    """Removes optional matching quotation marks surrounding dialogue text."""
    text = text.strip()
    if REMOVE_QUOTATION_MARKS:
        if (
            (text.startswith('"') and text.endswith('"')) or
            (text.startswith("'") and text.endswith("'"))
        ):
            return text[1:-1].strip()
    return text


def load_py_config(file_path: str, environment: dict) -> bool:
    """Loads a Python configuration file into a scenario runtime environment."""
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


def parse_dreamrun_blocks(file_path: str):
    """
    Parses a .dreamrun scenario file. 
    Isolates [ref] blocks completely so they are skipped in linear execution 
    and can only be accessed via explicit [jump] instructions.
    """
    if not os.path.exists(file_path):
        return None

    main_steps = []
    next_act = None
    references_map = {}

    with open(file_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    in_python_block = False
    python_block_accumulator = []
    scope_stack = []

    for line_idx, line in enumerate(lines):
        stripped = line.strip()

        if stripped == "[python]":
            in_python_block = True
            python_block_accumulator = []
            continue

        if stripped == "[/python]":
            in_python_block = False
            target_step = {"type": "python_exec", "code": "\n".join(python_block_accumulator)}
            
            # Route step based on whether we are inside a reference or an answer branch
            if scope_stack:
                if scope_stack[-1]["type"] == "ref":
                    scope_stack[-1]["steps"].append(target_step)
                elif scope_stack[-1]["type"] == "answer_paired":
                    scope_stack[-1]["children"].append(target_step)
            else:
                main_steps.append(target_step)
            continue

        if in_python_block:
            python_block_accumulator.append(line.rstrip("\r\n"))
            continue

        if not stripped or stripped.startswith("#"):
            continue

        # --- 1. PASS TAG ---
        if stripped == "[pass/]":
            target_step = {"type": "pass"}
            if scope_stack:
                if scope_stack[-1]["type"] == "ref":
                    scope_stack[-1]["steps"].append(target_step)
                elif scope_stack[-1]["type"] == "answer_paired":
                    scope_stack[-1]["children"].append(target_step)
            else:
                main_steps.append(target_step)
            continue

        # --- 2. NEXT ACT TAG ---
        next_match = re.match(r'^\[next\s+"(.*)"\s*/?\]$', stripped)
        if next_match:
            next_act = next_match.group(1).strip()
            continue

        # --- 3. JUMP REF TAG ---
        jump_match = re.match(r'^\[jump\s+"(.*)"\s*/?\]$', stripped)
        if jump_match:
            target_step = {"type": "jump", "target": jump_match.group(1).strip()}
            if scope_stack:
                if scope_stack[-1]["type"] == "ref":
                    scope_stack[-1]["steps"].append(target_step)
                elif scope_stack[-1]["type"] == "answer_paired":
                    scope_stack[-1]["children"].append(target_step)
            else:
                main_steps.append(target_step)
            continue

        # --- 4. INLINE PYTHON TAG ---
        single_py_match = re.match(r'^\[python\s+"(.*)"\s*/?\]$', stripped)
        if single_py_match:
            target_step = {"type": "python_exec", "code": single_py_match.group(1)}
            if scope_stack:
                if scope_stack[-1]["type"] == "ref":
                    scope_stack[-1]["steps"].append(target_step)
                elif scope_stack[-1]["type"] == "answer_paired":
                    scope_stack[-1]["children"].append(target_step)
            else:
                main_steps.append(target_step)
            continue

        # --- 5. BACKGROUND TAG ---
        bg_match = re.match(r'^\[bg\s+"(.*)"\s*/?\]$', stripped)
        if bg_match:
            bg_target = bg_match.group(1).strip()
            if bg_target.startswith("/"):
                bg_target = f"/assets{bg_target}"
            target_step = {"type": "bg", "value": bg_target}
            if scope_stack:
                if scope_stack[-1]["type"] == "ref":
                    scope_stack[-1]["steps"].append(target_step)
                elif scope_stack[-1]["type"] == "answer_paired":
                    scope_stack[-1]["children"].append(target_step)
            else:
                main_steps.append(target_step)
            continue

        # --- 6. CONFIGURATION IMPORT TAG ---
        cfg_match = re.match(r'^\[config\s+"(.*)"\s*/?\]$', stripped)
        if cfg_match:
            filename = cfg_match.group(1).strip()
            if not filename.endswith(".py"):
                filename = f"{filename}.py"
            target_step = {"type": "cfg_import", "filename": filename}
            if scope_stack:
                if scope_stack[-1]["type"] == "ref":
                    scope_stack[-1]["steps"].append(target_step)
                elif scope_stack[-1]["type"] == "answer_paired":
                    scope_stack[-1]["children"].append(target_step)
            else:
                main_steps.append(target_step)
            continue

        # --- 7. REFERENCE BLOCK TAGS ---
        ref_open_match = re.match(r'^\[ref\s+"(.*)"\]$', stripped)
        if ref_open_match:
            if any(s["type"] == "ref" for s in scope_stack):
                raise ValueError(f"Syntax Error line {line_idx}: Nested [ref] blocks are strictly forbidden.")
            
            ref_name = ref_open_match.group(1).strip()
            scope_stack.append({
                "type": "ref",
                "name": ref_name,
                "steps": []  # Collect steps into an isolated bucket
            })
            continue

        if stripped == "[/ref]":
            if not scope_stack or scope_stack[-1]["type"] != "ref":
                raise ValueError(f"Syntax Error line {line_idx}: Mismatched closed tag [/ref].")
            
            ref_meta = scope_stack.pop()
            if not ref_meta["steps"]:
                raise ValueError(f"Syntax Error: Reference block '{ref_meta['name']}' cannot be empty.")
            
            # Map the reference name directly to its isolated execution queue
            references_map[ref_meta["name"]] = ref_meta["steps"]
            continue

        # --- 8. CHOICE BLOCK TAGS ---
        if stripped == "[choice]":
            if scope_stack and scope_stack[-1]["type"] == "ref":
                raise ValueError(f"Syntax Error line {line_idx}: [choice] cannot be nested inside a reference block directly.")
            scope_stack.append({"type": "choice", "answers": []})
            continue

        if stripped == "[/choice]":
            if not scope_stack or scope_stack[-1]["type"] != "choice":
                raise ValueError(f"Syntax Error line {line_idx}: Mismatched closed tag [/choice].")
            
            choice_meta = scope_stack.pop()
            target_step = {
                "type": "choice",
                "options": choice_meta["answers"]
            }
            
            if scope_stack and scope_stack[-1]["type"] == "answer_paired":
                scope_stack[-1]["children"].append(target_step)
            else:
                main_steps.append(target_step)
            continue

        # --- 9. ANSWER TAGS ---
        answer_self_match = re.match(r'^\[answer\s+"([^"]+)"\s+"([^"]+)"\s*/?\]$', stripped)
        if answer_self_match:
            if not scope_stack or scope_stack[-1]["type"] != "choice":
                raise ValueError(f"Syntax Error line {line_idx}: [answer] tags require an open [choice] parent block.")
            
            ans_text = answer_self_match.group(1).strip()
            ans_inline_payload = answer_self_match.group(2).strip()
            
            payload_step = None
            if ans_inline_payload.startswith("[") and ans_inline_payload.endswith("]"):
                if "[bg" in ans_inline_payload:
                    m = re.match(r'^\[bg\s+"(.*)"\s*/?\]$', ans_inline_payload)
                    if m:
                        bg_val = m.group(1).strip()
                        payload_step = {"type": "bg", "value": f"/assets{bg_val}" if bg_val.startswith("/") else bg_val}
                elif "[python" in ans_inline_payload:
                    m = re.match(r'^\[python\s+"(.*)"\s*/?\]$', ans_inline_payload)
                    if m:
                        payload_step = {"type": "python_exec", "code": m.group(1)}
                elif "[config" in ans_inline_payload:
                    m = re.match(r'^\[config\s+"(.*)"\s*/?\]$', ans_inline_payload)
                    if m:
                        filename = m.group(1)
                        payload_step = {"type": "cfg_import", "filename": filename if filename.endswith(".py") else f"{filename}.py"}
                elif "[jump" in ans_inline_payload:
                    m = re.match(r'^\[jump\s+"(.*)"\s*/?\]$', ans_inline_payload)
                    if m:
                        payload_step = {"type": "jump", "target": m.group(1).strip()}
                elif "[pass" in ans_inline_payload:
                    payload_step = {"type": "pass"}
            else:
                payload_step = {"type": "dialogue", "speaker_mode": "narrator", "text": clean_dialogue_text(ans_inline_payload)}
            
            if not payload_step:
                raise ValueError(f"Syntax Error line {line_idx}: Invalid content structure inside answer.")
            
            scope_stack[-1]["answers"].append({
                "text": ans_text,
                "type": "self_closing",
                "action": payload_step
            })
            continue

        answer_paired_match = re.match(r'^\[answer\s+"([^"]+)"\]$', stripped)
        if answer_paired_match:
            if not scope_stack or scope_stack[-1]["type"] != "choice":
                raise ValueError(f"Syntax Error line {line_idx}: [answer] tags require an open [choice] parent block.")
            
            ans_text = answer_paired_match.group(1).strip()
            scope_stack.append({"type": "answer_paired", "text": ans_text, "children": []})
            continue

        if stripped == "[/answer]":
            if not scope_stack or scope_stack[-1]["type"] != "answer_paired":
                raise ValueError(f"Syntax Error line {line_idx}: Mismatched closed tag [/answer].")
            
            paired_meta = scope_stack.pop()
            if scope_stack and scope_stack[-1]["type"] == "choice":
                scope_stack[-1]["answers"].append({
                    "text": paired_meta["text"],
                    "type": "paired",
                    "branches": paired_meta["children"]
                })
            continue

        # --- 10. DIALOGUE TEXT TAG PROCESSING LINES ---
        var_char_match = re.match(r'^:([a-zA-Z_][a-zA-Z0-9_]*):\s*>\s*(.*)$', stripped)
        if var_char_match:
            target_step = {
                "type": "dialogue",
                "speaker_mode": "variable",
                "key": var_char_match.group(1),
                "text": clean_dialogue_text(var_char_match.group(2))
            }
            if scope_stack:
                if scope_stack[-1]["type"] == "ref":
                    scope_stack[-1]["steps"].append(target_step)
                elif scope_stack[-1]["type"] == "answer_paired":
                    scope_stack[-1]["children"].append(target_step)
            else:
                main_steps.append(target_step)
            continue

        raw_char_match = re.match(r'^([^>]+)>\s*(.*)$', stripped)
        if raw_char_match and not stripped.startswith(">"):
            target_step = {
                "type": "dialogue",
                "speaker_mode": "literal",
                "name": raw_char_match.group(1).strip(),
                "text": clean_dialogue_text(raw_char_match.group(2))
            }
            if scope_stack:
                if scope_stack[-1]["type"] == "ref":
                    scope_stack[-1]["steps"].append(target_step)
                elif scope_stack[-1]["type"] == "answer_paired":
                    scope_stack[-1]["children"].append(target_step)
            else:
                main_steps.append(target_step)
            continue

        if stripped.startswith(">"):
            target_step = {
                "type": "dialogue",
                "speaker_mode": "narrator",
                "text": clean_dialogue_text(stripped[1:].strip())
            }
            if scope_stack:
                if scope_stack[-1]["type"] == "ref":
                    scope_stack[-1]["steps"].append(target_step)
                elif scope_stack[-1]["type"] == "answer_paired":
                    scope_stack[-1]["children"].append(target_step)
            else:
                main_steps.append(target_step)
            continue

        raise ValueError(f"Engine Compilation Exception at line {line_idx + 1}: Unrecognized syntax expression context token: '{stripped}'")

    if scope_stack:
        raise ValueError(f"Syntax Error: Unclosed tags remaining: {[s['type'] for s in scope_stack]}")

    return {"steps": main_steps, "next_act": next_act, "references": references_map}


def execute_runtime(session_id: str, max_dialogues: int = PREFETCH_COUNT) -> list:
    """Processes server-side scenario execution pipelines using subroutine stack frames."""
    session = SESSIONS[session_id]
    env = session["runtime_env"]
    dialogues = []
    pending_bg = None

    while len(dialogues) < max_dialogues:
        # Check if the CURRENT execution track is exhausted
        if session["step_index"] >= len(session["cached_steps"]):
            # SUBROUTINE RETURN: Check if we are currently inside a reference block and need to go home
            if session["return_stack"]:
                frame = session["return_stack"].pop()
                session["cached_steps"] = frame["steps"]
                session["step_index"] = frame["index"]
                continue

            # If the main act track is exhausted, try loading the next act file
            if session["next_act_path"]:
                next_file = os.path.join(SCENARIOS_DIR, os.path.basename(session["next_act_path"]))
                data = parse_dreamrun_blocks(next_file)

                if not data:
                    raise HTTPException(
                        status_code=404,
                        detail={"status": "CHAPTER_MISSING_ERROR", "message": "Next act file not found."}
                    )

                session["current_act"] = next_file
                session["cached_steps"] = data["steps"]
                session["step_index"] = 0
                session["next_act_path"] = data["next_act"]
                session["references"] = data["references"]
                continue
            break

        step = session["cached_steps"][session["step_index"]]

        if step["type"] == "choice":
            options_payload = []
            for idx, opt in enumerate(step["options"]):
                options_payload.append({"index": idx, "text": opt["text"]})
            
            dialogues.append({
                "type": "choice",
                "bg": pending_bg,
                "options": options_payload
            })
            break

        session["step_index"] += 1

        if step["type"] == "pass":
            continue

        # --- JUMP CALL (Pushes current execution trace onto the stack frame) ---
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

            # Save the active step sequence grid and the next pointer state
            session["return_stack"].append({
                "steps": session["cached_steps"],
                "index": session["step_index"]
            })

            # Hot-swap runtime steps onto the isolated subroutine reference array block
            session["cached_steps"] = session["references"][target_ref]
            session["step_index"] = 0
            continue

        if step["type"] == "python_exec":
            try:
                exec(step["code"], {}, env)
            except Exception as e:
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

        elif step["type"] == "cfg_import":
            cfg_path = os.path.join(CONFIG_DIR, step["filename"])
            if not os.path.exists(cfg_path):
                raise HTTPException(
                    status_code=404,
                    detail={"status": "CONFIG_MISSING_ERROR", "message": f"Asset missing: {step['filename']}"}
                )
            try:
                load_py_config(cfg_path, env)
            except Exception as e:
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

        elif step["type"] == "bg":
            pending_bg = step["value"]
            continue

        elif step["type"] == "dialogue":
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

            dialogues.append({
                "type": "dialogue",
                "name": name,
                "text": text,
                "bg": pending_bg
            })
            pending_bg = None
            continue

    return dialogues


@app.post("/api/game/start")
async def start_game():
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
        "next_act_path": data["next_act"],
        "runtime_env": {"Character": Character},
        "references": data["references"],
        "return_stack": [],
        "last_request_time": 0
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
    if not x_session_id or x_session_id not in SESSIONS:
        raise HTTPException(
            status_code=401,
            detail={"status": "UNAUTHORIZED_SESSION", "message": "Session context invalid or expired."}
        )

    session = SESSIONS[x_session_id]
    current_time = time.time()

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
    session["step_index"] += 1

    if chosen_option["type"] == "self_closing":
        session["cached_steps"].insert(session["step_index"], chosen_option["action"])
    elif chosen_option["type"] == "paired":
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