import os

# Base directory initialization.
# BASE_DIR points to the project root.
# All scenario, config and asset paths are resolved relative to it,
# so the engine can be moved to another machine without rewriting paths.
BASE_DIR = os.path.dirname(os.path.dirname(__file__))

# Root folders used by the engine at runtime.
SCENARIOS_DIR = os.path.join(BASE_DIR, "acts")     # .dreamrun scenario scripts
CONFIG_DIR = os.path.join(BASE_DIR, "config")      # .py config modules
ASSETS_DIR = os.path.join(BASE_DIR, "assets")      # backgrounds, images, audio

# Entry scenario file that is executed when the player presses "Start".
INDEX_ACT = "index.dreamrun"

# Global variables file loaded into every new session environment.
DEFAULT_VARS_FILE = os.path.join(CONFIG_DIR, "--vars.py")

# If True, the parser strips matching outer quotes from dialogue lines.
# Set to False if you want to preserve quotation marks in the rendered text.
REMOVE_QUOTATION_MARKS = True

# Pagination cluster configuration.
# Controls how many dialogue frames are returned to the client per request.
# Increasing this value reduces network round-trips but also reduces
# the responsiveness of rate-limit / choice handling.
# Recommended range: 1 (very interactive) to 6 (chatty scenes).
PREFETCH_COUNT = 5

# Global dictionary storing all active game runtime sessions
SESSIONS = {}

# Bootstrapping structure layers securely.
# Ensures that the runtime can start even if the folders do not exist yet.
os.makedirs(ASSETS_DIR, exist_ok=True)
os.makedirs(CONFIG_DIR, exist_ok=True)
os.makedirs(SCENARIOS_DIR, exist_ok=True)