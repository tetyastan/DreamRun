import os
import re
from fastapi import HTTPException
from src.tags.base import BaseTag, TagParseResult
from src.config import CONFIG_DIR # Ensure CONFIG_DIR points to your backend config folder

class ConfigTag(BaseTag):
    """
    Handles [config "filename.py"/] or dynamic context configurations loader.
    """
    name = "config"
    PATTERN = re.compile(r'^\[config\s+(?:"(?P<path>[^"]+)"|(?P<var>\{[A-Za-z0-9_\.]+\}))/\]$')

    def parse(self, line: str, line_idx: int, ctx: dict) -> TagParseResult:
        m = self.PATTERN.match(line)
        if not m:
            return TagParseResult(consumed=False)
        
        path_token = m.group("path") if m.group("path") is not None else m.group("var")
        return TagParseResult(
            step={"type": "load_config", "file_path": path_token.strip()},
            consumed=True
        )

    def execute(self, step: dict, ctx: dict):
        if step.get("type") != "load_config":
            return None

        file_target = step["file_path"]
        # Resolve target module absolute path coordinates
        if not file_target.startswith("/"):
            absolute_path = os.path.join(CONFIG_DIR, file_target)
        else:
            absolute_path = file_target

        # Strict check loop before compiling modules bindings
        if not os.path.exists(absolute_path):
            raise HTTPException(
                status_code=422,
                detail={
                    "status": "CONFIG_FILE_MISSING_ERROR",
                    "message": f"Initialization config file script not found on server disk: {file_target}",
                    "details": f"Expected target location: {absolute_path}"
                }
            )

        # Import the dynamic config loader directly into active env
        from src.runtime import load_py_config
        load_py_config(absolute_path, ctx["env"])
        return None
