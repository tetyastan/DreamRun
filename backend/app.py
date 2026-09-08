from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
import os
import uuid

app = FastAPI()

# Разрешаем запросы от фронтенда Svelte
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SCENARIOS_DIR = os.path.join(os.path.dirname(__file__), "acts")

SESSIONS = {}

def parse_dreamrun(file_path: str):
    """
    Parsing DreamRun scenario.
    Format:
    1. "bg: URL": Changing background.
    2. "NAME: TEXT": Dialogue with name.
    3. "TEXT": Dialogue without name / narrator.
    4. "next: FILENAME": Select next act.
    """
    if not os.path.exists(file_path):
        return None
        
    steps = []
    next_act = None
    
    with open(file_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"): # Ignore empty strings and comments.
                continue
                
            if line.startswith("next:"):
                next_act = line.split(":", 1)[1].strip()
                continue
                
            if line.startswith("bg:"):
                bg_url = line.split(":", 1)[1].strip()
                steps.append({"type": "bg", "value": bg_url})
                continue
                
            if ":" in line:
                name, text = line.split(":", 1)
                steps.append({"type": "dialogue", "name": name.strip(), "text": text.strip()})
            else:
                steps.append({"type": "dialogue", "name": None, "text": line})
                
    return {"steps": steps, "next_act": next_act}

@app.post("/api/game/start")
def start_game():
    """Creates a new session and returns its ID along with the first act."""
    session_id = str(uuid.uuid4())
    first_act = f"{SCENARIOS_DIR}/index.dreamrun"
    
    data = parse_dreamrun(first_act)
    if not data:
        raise HTTPException(status_code=404, detail="Начальный файл index.dreamrun не найден")
        
    # This session is currently on index.dreamrun.
    SESSIONS[session_id] = {"current_act": first_act}
    
    return {
        "session_id": session_id,
        "steps": data["steps"],
        "has_next": bool(data["next_act"])
    }


@app.post("/api/game/next")
def next_scene(x_session_id: str = Header(None, alias="X-Session-ID")):
    """Advances the player to the next step based on their current session."""
    if not x_session_id or x_session_id not in SESSIONS:
        raise HTTPException(status_code=401, detail="Session none/expired.")
        
    current_act = SESSIONS[x_session_id]["current_act"]
    current_data = parse_dreamrun(current_act)
    
    if not current_data or not current_data["next_act"]:
        # Game ended
        SESSIONS.pop(x_session_id, None) # Remove session
        return {"steps": [], "has_next": False}
        
    next_act_file = current_data["next_act"]
    next_data = parse_dreamrun(next_act_file)
    
    if not next_data:
        raise HTTPException(status_code=404, detail=f"Файл следующего акта {next_act_file} не найден")
        
    # Updating the session state on the server.
    # The player is now officially in the next act.
    SESSIONS[x_session_id]["current_act"] = next_act_file
    
    return {
        "steps": next_data["steps"],
        "has_next": bool(next_data["next_act"])
    }