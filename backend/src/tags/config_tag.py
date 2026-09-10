import os
import re
import importlib.util
import uuid
import traceback
from fastapi import HTTPException
from src.tags.base import BaseTag, TagParseResult
from src.config import CONFIG_DIR


class ConfigTag(BaseTag):
    """
    Handles [config "file"/].

    Imports a Python module from CONFIG_DIR into the session env.
    Filenames are resolved with the .py extension appended if missing.
    """
    name = "config"

    PATTERN = re.compile(r'^\[config\s+"(.*)"\s*/?\]$')

    def parse(self, line: str, line_idx: int, ctx: dict) -> TagParseResult:
        m = self.PATTERN.match(line)
        if not m:
            return TagParseResult(consumed=False)

        filename = m.group(1).strip()
        if not filename.endswith(".py"):
            filename = f"{filename}.py"
        return TagParseResult(
            step={"type": "cfg_import", "filename": filename},
            consumed=True,
        )

    def execute(self, step: dict, ctx: dict):
        if step.get("type") != "cfg_import":
            return None

        env = ctx["env"]
        cfg_path = os.path.join(CONFIG_DIR, step["filename"])

        if not os.path.exists(cfg_path):
            raise HTTPException(
                status_code=404,
                detail={
                    "status": "CONFIG_MISSING_ERROR",
                    "message": f"Asset missing: {step['filename']}",
                },
            )

        try:
            module_name = f"dynamic_config_{uuid.uuid4().hex}"
            spec = importlib.util.spec_from_file_location(module_name, cfg_path)
            if spec is None or spec.loader is None:
                raise Exception(f"Unable to create import specification for '{cfg_path}'.")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            for key, value in module.__dict__.items():
                if not key.startswith("__") and key != "Character":
                    env[key] = value
        except Exception:
            trace = traceback.format_exc()
            raise HTTPException(
                status_code=422,
                detail={
                    "status": "CONFIG_PARSE_ERROR",
                    "message": "Syntax compilation failure.",
                    "details": str(trace),
                },
            )
        return None