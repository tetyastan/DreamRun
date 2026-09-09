from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import importlib.util
import os
import re
import uuid

# Import Character class from the engine core.
#
# :hero: > "Hello!"
#
# If hero contains a Character instance, its .name is shown to the player.
from core import Character


app = FastAPI()


# CORS
# The frontend and backend may run on different origins during development.
#
# CORS allows the browser to make requests between these origins.
#
# For production, allow_origins should ideally contain only the real
# frontend origin instead of "*".
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ENGINE PATHS AND GLOBAL SETTINGS

# Directory containing .dreamrun scenario files.
SCENARIOS_DIR = os.path.join(os.path.dirname(__file__), "acts")

# Directory containing Python configuration files used by scenarios.
CONFIG_DIR = os.path.join(os.path.dirname(__file__), "config")

# Directory containing images and other public game assets.
ASSETS_DIR = os.path.join(os.path.dirname(__file__), "assets")

# The entry-point scenario loaded when a new game session starts.
INDEX_ACT = "index.dreamrun"

# Global variables are loaded into every new game session before the first
# scenario instruction is executed.
DEFAULT_VARS_FILE = os.path.join(CONFIG_DIR, "--vars.py")

# If True, dialogue text such as:
#
# Alice > "Hello"
#
# becomes:
#
# Hello
#
# The outer quotation marks are treated as script syntax rather than
# displaying them as part of the dialogue.
REMOVE_QUOTATION_MARKS = True


# PREFETCH CONFIGURATION
# The backend does not send the complete scenario to the browser.
#
# Instead, execute_runtime() executes the scenario on the server and collects
# only a limited number of upcoming dialogues.
#
# Example with PREFETCH_COUNT = 3:
#
#     Request #1 -> dialogue 1, dialogue 2, dialogue 3
#     Request #2 -> dialogue 4, dialogue 5, dialogue 6
#     Request #3 -> dialogue 7, dialogue 8, dialogue 9
#
# The browser keeps the received dialogues in a local queue and does not need
# another HTTP request for every click.
#
# This is NOT encryption and is not intended to be encryption.
# Its purpose is to avoid sending the entire future scenario to the client.
PREFETCH_COUNT = 3


# DIRECTORY INITIALIZATION
#
# Creating these directories here makes the backend capable of starting on a
# clean installation where the directories have not yet been created.
os.makedirs(ASSETS_DIR, exist_ok=True)
os.makedirs(CONFIG_DIR, exist_ok=True)
os.makedirs(SCENARIOS_DIR, exist_ok=True)


# Assets are intentionally exposed as static files because the frontend needs
# to load backgrounds and other public resources.
#
# IMPORTANT:
# Anything exposed through /assets is public to the client. Therefore,
# future story text should never be treated as protected merely because its
# corresponding image is stored here.
app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")


# ACTIVE GAME SESSIONS
# Each running game receives its own session ID.
#
# Current structure:
#
#     SESSIONS[session_id] = {
#         "current_act": "...",
#         "cached_steps": [...],
#         "step_index": 0,
#         "next_act_path": "...",
#         "runtime_env": {...}
#     }
#
# This dictionary is intentionally simple for the current local/small-server
# implementation.
#
# For a production multiplayer deployment, this should eventually be replaced
# with persistent/session-aware storage such as Redis or a database.
SESSIONS = {}
 

# DIALOGUE TEXT CLEANING

def clean_dialogue_text(text: str) -> str:
    """
    Removes optional matching quotation marks surrounding dialogue text.

    Example:

        > "Hello!"

    becomes:

        Hello!

    This only removes a pair of quotation marks when they are both at the
    beginning and at the end of the complete dialogue string.
    """

    text = text.strip()

    if REMOVE_QUOTATION_MARKS:
        if (
            (text.startswith('"') and text.endswith('"'))
            or
            (text.startswith("'") and text.endswith("'"))
        ):
            return text[1:-1].strip()

    return text


# PYTHON CONFIGURATION LOADER

def load_py_config(file_path: str, environment: dict) -> bool:
    """
    Loads a Python configuration file into a scenario runtime environment.

    Configuration files are ordinary Python files. Their public variables are
    copied into the supplied environment dictionary.

    Example config:

        hero = Character("Alice")
        
        some_value = 10

    After loading:

        environment["hero"]      -> Character("Alice")
        
        environment["some_value"] -> 10

    Names beginning with "__" are ignored because they are Python module
    internals.

    Character is deliberately not overwritten because the engine provides its
    own Character class to the runtime.
    """

    if not os.path.exists(file_path):
        return False

    try:
        # A unique module name prevents different dynamic configuration files
        # from accidentally sharing the same import-cache entry.
        module_name = f"dynamic_config_{uuid.uuid4().hex}"

        # Build a Python import specification directly from the physical file.
        spec = importlib.util.spec_from_file_location(
            module_name,
            file_path
        )

        if spec is None or spec.loader is None:
            raise Exception(
                f"Unable to create import specification for '{file_path}'."
            )

        # Create a module object from the specification.
        module = importlib.util.module_from_spec(spec)

        # Execute the configuration file.
        spec.loader.exec_module(module)

        # Copy public configuration values into the session runtime.
        for key, value in module.__dict__.items():
            if not key.startswith("__") and key != "Character":
                environment[key] = value

        return True

    except Exception as e:
        raise Exception(str(e))


# DREAMRUN FORMAT SCRIPT PARSER

def parse_dreamrun_blocks(file_path: str):
    """
    Parses a .dreamrun scenario file into an ordered list of runtime steps.

    Supported instructions currently include:

        [python]
        
        ...
        
        [/python]

        [python "code"/]

        [bg "path"/]

        [config "filename"/]

        [next "another_act.dreamrun"/]

        :variable: > "Dialogue"

        Character Name > "Dialogue"

        > "Narrator dialogue"

    The parser does NOT execute Python code.

    It only converts the textual script into structured instructions.
    Actual execution happens later inside execute_runtime().
    """

    if not os.path.exists(file_path):
        return None

    steps = []
    next_act = None

    with open(file_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    in_python_block = False
    python_block_accumulator = []

    for line in lines:
        stripped = line.strip()

        # Multi-line Python block
        if stripped == "[python]":
            in_python_block = True
            python_block_accumulator = []
            continue

        if stripped == "[/python]":
            in_python_block = False

            full_code = "\n".join(python_block_accumulator)

            steps.append({
                "type": "python_exec",
                "code": full_code
            })

            continue

        # While inside [python] ... [/python], every line belongs to Python.
        if in_python_block:
            python_block_accumulator.append(line.rstrip("\r\n"))
            continue

        # Empty lines and comments do not produce runtime instructions.
        if not stripped or stripped.startswith("#"):
            continue

        # Next act
        # Supported:
        #
        #     [next "act2.dreamrun"]
        #     [next "act2.dreamrun"/]
        #
        # The path is stored in the current act and is loaded only when the
        # current act has been completely consumed.
        next_match = re.match(
            r'^\[next\s+"(.*)"\s*/?\]$',
            stripped
        )

        if next_match:
            next_act = next_match.group(1).strip()
            continue

        # Single-line Python
        single_py_match = re.match(
            r'^\[python\s+"(.*)"\s*/\]$',
            stripped
        )

        if single_py_match:
            steps.append({
                "type": "python_exec",
                "code": single_py_match.group(1)
            })

            continue

        # Background
        bg_match = re.match(
            r'^\[bg\s+"(.*)"\s*/?\]$',
            stripped
        )

        if bg_match:
            bg_target = bg_match.group(1).strip()

            # A leading slash means the path is relative to the public assets
            # directory. Internally the API represents such paths as
            # /assets/...
            if bg_target.startswith("/"):
                bg_target = f"/assets{bg_target}"

            steps.append({
                "type": "bg",
                "value": bg_target
            })

            continue

        # Python configuration import
        cfg_match = re.match(
            r'^\[config\s+"(.*)"\s*/?\]$',
            stripped
        )

        if cfg_match:
            filename = cfg_match.group(1).strip()

            if not filename.endswith(".py"):
                filename = f"{filename}.py"

            steps.append({
                "type": "cfg_import",
                "filename": filename
            })

            continue

        # Variable speaker
        # Example:
        #
        #     :hero: > "Hello!"
        #
        # The actual speaker name is resolved at runtime because the variable
        # may have been changed by Python code before this dialogue.
        var_char_match = re.match(
            r'^:([a-zA-Z_][a-zA-Z0-9_]*):\s*>\s*(.*)$',
            stripped
        )

        if var_char_match:
            steps.append({
                "type": "dialogue",
                "speaker_mode": "variable",
                "key": var_char_match.group(1),
                "text": clean_dialogue_text(
                    var_char_match.group(2)
                )
            })

            continue

        # Literal speaker
        # Example:
        #
        #     Alice > "Hello!"
        #
        # The speaker is stored directly in the parsed instruction.
        raw_char_match = re.match(
            r'^([^>]+)>\s*(.*)$',
            stripped
        )

        if raw_char_match and not stripped.startswith(">"):
            steps.append({
                "type": "dialogue",
                "speaker_mode": "literal",
                "name": raw_char_match.group(1).strip(),
                "text": clean_dialogue_text(
                    raw_char_match.group(2)
                )
            })

            continue

        # Narrator
        # Example:
        #
        # > "The room became silent."
        #
        # Narrator dialogues do not have a speaker name.
        if stripped.startswith(">"):
            narrator_text = stripped[1:].strip()

            steps.append({
                "type": "dialogue",
                "speaker_mode": "narrator",
                "text": clean_dialogue_text(narrator_text)
            })

            continue

    return {
        "steps": steps,
        "next_act": next_act
    }


# SERVER-SIDE RUNTIME + PREFETCH

def execute_runtime(
    session_id: str,
    max_dialogues: int = PREFETCH_COUNT
) -> list:
    """
    Executes the current scenario runtime and returns a limited block of
    upcoming dialogues.
    This is the central part of the prefetch system.

    The function continues through technical instructions until it has
    collected max_dialogues dialogue entries.

    Background changes are attached to the next dialogue:

        [bg "/room.png"]
        Alice > "Hello"

    becomes approximately:

        {
            "type": "dialogue",
            "name": "Alice",
            "text": "Hello",
            "bg": "/assets/room.png"
        }
    """

    session = SESSIONS[session_id]
    env = session["runtime_env"]

    dialogues = []

    # Stores a background encountered before the next dialogue.
    pending_bg = None

    while len(dialogues) < max_dialogues:

        # Current act exhausted
        if session["step_index"] >= len(session["cached_steps"]):

            # If another act exists, load it and continue collecting dialogues.
            if session["next_act_path"]:
                next_file = os.path.join(
                    SCENARIOS_DIR,
                    os.path.basename(session["next_act_path"])
                )

                data = parse_dreamrun_blocks(next_file)

                if not data:
                    raise HTTPException(
                        status_code=404,
                        detail={
                            "status": "CHAPTER_MISSING_ERROR",
                            "message": (
                                f"Next act chapter script file "
                                f"'{next_file}' not found."
                            ),
                            "details": (
                                "Verify your scripts references point "
                                "to an existing act file."
                            )
                        }
                    )

                # Replace the current act with the next one.
                session["current_act"] = next_file
                session["cached_steps"] = data["steps"]
                session["step_index"] = 0
                session["next_act_path"] = data["next_act"]

                # Continue the same prefetch operation. This means a single
                # request may cross an act boundary if necessary to collect
                # the requested number of dialogues.
                continue

            # No next act exists, so there is nothing more to execute.
            break

        # Get the next instruction and immediately move the session pointer.
        #
        # Advancing step_index before execution is important because the
        # runtime must remember exactly where it stopped if the request ends.
        step = session["cached_steps"][session["step_index"]]
        session["step_index"] += 1

        # Python execution
        if step["type"] == "python_exec":
            try:
                # Scenario Python executes inside the session environment.
                #
                # The environment contains Character and variables loaded
                # from configuration files or previous Python blocks.
                exec(step["code"], {}, env)

            except Exception as e:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "status": "SCRIPT_RUNTIME_ERROR",
                        "message": (
                            "Failed to execute Python block expression "
                            "structural context."
                        ),
                        "details": (
                            f"Interpreter Exception Trace: {str(e)}"
                        )
                    }
                )

            # Python instructions are server-side implementation details.
            # They are never sent to the browser.
            continue

        # Configuration import
        elif step["type"] == "cfg_import":
            cfg_path = os.path.join(
                CONFIG_DIR,
                step["filename"]
            )

            if not os.path.exists(cfg_path):
                raise HTTPException(
                    status_code=404,
                    detail={
                        "status": "CONFIG_MISSING_ERROR",
                        "message": (
                            "Required configuration tracker asset "
                            f"'{step['filename']}' could not be located."
                        ),
                        "details": (
                            f"Expected target location map: {cfg_path}"
                        )
                    }
                )

            try:
                load_py_config(cfg_path, env)

            except Exception as e:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "status": "CONFIG_PARSE_ERROR",
                        "message": (
                            "Syntax error compilation failure within "
                            f"config file reference: {step['filename']}"
                        ),
                        "details": f"Exception Message: {str(e)}"
                    }
                )

            # Configuration instructions are also server-side only.
            continue

        # Background
        elif step["type"] == "bg":
            # Do not immediately return a separate background instruction.
            # Instead attach the background to the next dialogue.
            pending_bg = step["value"]
            continue

        # Dialogue
        elif step["type"] == "dialogue":

            name = None

            # Resolve variable speakers at runtime.
            if step["speaker_mode"] == "variable":
                var_key = step["key"]

                if (
                    var_key in env
                    and isinstance(env[var_key], Character)
                ):
                    name = env[var_key].name
                else:
                    # If the variable does not contain a Character,
                    # preserve the variable key as a fallback speaker name.
                    name = var_key

            # Literal speaker names require no runtime lookup.
            elif step["speaker_mode"] == "literal":
                name = step["name"]

            text = step["text"]

            # Runtime variable formatting
            # Example script:
            #
            # :hero: > "I have {gold} coins."
            #
            # If env["gold"] == 100, the resulting dialogue becomes:
            #
            # I have 100 coins.
            #
            # Formatting happens on the server before the dialogue is sent.
            # This keeps the scenario runtime logic on the backend.
            if text:
                try:
                    formatting_map = {
                        key: value
                        for key, value in env.items()
                    }

                    text = text.format(**formatting_map)

                except Exception:
                    # Preserve the original text if formatting fails.
                    #
                    # This matches the previous engine behavior and prevents
                    # one formatting mistake from destroying the whole scene.
                    pass

            # Public dialogue payload
            #
            # The frontend receives exactly the text it needs to display.
            # Future dialogues remain on the server until a later prefetch
            # request asks for them.
            dialogues.append({
                "type": "dialogue",
                "name": name,
                "text": text,
                "bg": pending_bg
            })

            # The background has now been consumed by this dialogue.
            pending_bg = None

            continue

    return dialogues


# START GAME
@app.post("/api/game/start")
def start_game():
    """
    Creates a completely new game session.

    The first request does not return the complete scenario.

    Instead, a unique session identifier of the player is
    generated first, the script is loaded, global variables
    are initialized, and the runtime environment is executed until
    the number of dialogues equal to PREFETCH_COUNT is collected.
    """

    # Every start creates a new isolated runtime.
    session_id = str(uuid.uuid4())

    first_act = os.path.join(
        SCENARIOS_DIR,
        INDEX_ACT
    )

    data = parse_dreamrun_blocks(first_act)

    if not data:
        raise HTTPException(
            status_code=404,
            detail={
                "status": "ACT_MISSING_ERROR",
                "message": (
                    f"Act script tracker target file "
                    f"'{INDEX_ACT}' not found."
                ),
                "details": (
                    f"Target resolution location path: {first_act}"
                )
            }
        )

    # Create the session before loading the global variables because the
    # runtime environment belongs specifically to this session.
    SESSIONS[session_id] = {
        "current_act": first_act,
        "cached_steps": data["steps"],
        "step_index": 0,
        "next_act_path": data["next_act"],
        "runtime_env": {
            "Character": Character
        }
    }

    # Every game requires the global variable configuration.
    if not os.path.exists(DEFAULT_VARS_FILE):
        # Remove the incomplete session so it cannot remain in memory.
        SESSIONS.pop(session_id, None)

        raise HTTPException(
            status_code=500,
            detail={
                "status": "CORE_CONFIG_MISSING",
                "message": (
                    "The application core initialization variables "
                    "configuration file is missing."
                ),
                "details": (
                    "Please verify presence under path target location "
                    f"layout: {DEFAULT_VARS_FILE}"
                )
            }
        )

    try:
        # Load baseline variables before executing the first scenario step.
        load_py_config(
            DEFAULT_VARS_FILE,
            SESSIONS[session_id]["runtime_env"]
        )

    except Exception as e:
        # Do not leave a broken session in the global session registry.
        SESSIONS.pop(session_id, None)

        raise HTTPException(
            status_code=500,
            detail={
                "status": "CORE_CONFIG_PARSE_ERROR",
                "message": (
                    "Failed to compile baseline configurations asset."
                ),
                "details": f"Interpreter Trace: {str(e)}"
            }
        )

    # Execute only the first prefetch block.
    first_payload_steps = execute_runtime(session_id)

    session = SESSIONS[session_id]

    return {
        "session_id": session_id,

        # The frontend expects a block named "steps".
        "steps": first_payload_steps,

        # Send the current runtime variables as regular JSON.
        #
        # Character is excluded because it is a Python type rather than
        # game-state data intended for the browser.
        "variables": {
            key: value
            for key, value in session["runtime_env"].items()
            if key != "Character"
            and not isinstance(value, type)
        }
    }


# NEXT PREFETCH BLOCK
@app.post("/api/game/next")
def next_scene(
    x_session_id: str = Header(
        None,
        alias="X-Session-ID"
    )
):
    """
    Returns the next prefetched dialogue block for an existing session.

    The frontend calls this endpoint only when its local dialogue queue has
    become empty.

    Therefore one HTTP request can provide several future dialogue turns.
    """

    # A valid session ID is required for every continuation request.
    if not x_session_id or x_session_id not in SESSIONS:
        raise HTTPException(
            status_code=401,
            detail={
                "status": "UNAUTHORIZED_SESSION",
                "message": (
                    "Session expired or layout mapping mismatch "
                    "context tracking trace."
                ),
                "details": (
                    "Please restart execution pipeline from MainMenu."
                )
            }
        )

    # Execute the next server-side block.
    steps = execute_runtime(x_session_id)

    session = SESSIONS[x_session_id]

    # If no dialogues were produced, the runtime has reached the real end
    # of the complete scenario chain.
    if not steps:
        return {
            "steps": [
                {
                    "type": "game_end"
                }
            ],
            "variables": {
                key: value
                for key, value in session["runtime_env"].items()
                if key != "Character"
                and not isinstance(value, type)
            }
        }

    return {
        "steps": steps,
        "variables": {
            key: value
            for key, value in session["runtime_env"].items()
            if key != "Character"
            and not isinstance(value, type)
        }
    }
