import os
import re
from fastapi import HTTPException
from src.tags.base import BaseTag, TagParseResult
from src.config import ASSETS_DIR
from src.text_utils import parse_animated_value

class AudioTag(BaseTag):
    """
    Upgraded Audio execution layer. Safely accepts raw values, legacy string timelines, 
    and native variable references enclosed in curly braces.
    """
    name = "audio"

    # Captures the command modifier and leaves argument grouping strings for internal parsing splitters
    PATTERN = re.compile(r'^\[audio\s+(sound|music|modify|pause|resume|stop)\s+(.+)\]$')

    def parse(self, line: str, line_idx: int, ctx: dict) -> TagParseResult:
        m = self.PATTERN.match(line)
        if not m:
            return TagParseResult(consumed=False)

        modifier = m.group(1)
        raw_args = m.group(2).rstrip("/").strip()
        step = {"type": "audio", "modifier": modifier}

        # Safe token extractor split rules parsing parameters clean of quote bounds
        tokens = [t.strip() for t in re.split(r'\s+(?=(?:[^"]*"[^"]*")*[^"]*$)', raw_args)]

        try:
            if modifier in ("sound", "music"):
                if len(tokens) < 2:
                    raise ValueError("Audio missing required tracks IDs configurations.")
                
                # Normalize clean string representations from quote wrappings safely
                path = tokens[0].strip('"')
                
                step.update({
                    "path": path,
                    "id": tokens[1].strip('"'),
                    "volume": tokens[2].strip('"') if len(tokens) > 2 else "1.0",
                    "pitch": tokens[3].strip('"') if len(tokens) > 3 else "1.0"
                })

            elif modifier == "modify":
                if len(tokens) < 2:
                    raise ValueError("Audio modify operations require explicit target values.")
                step.update({
                    "id": tokens[0].strip('"'),
                    "volume": tokens[1].strip('"'),
                    "pitch": tokens[2].strip('"') if len(tokens) > 2 else None
                })
            else:
                step.update({"id": tokens[0].strip('"/')})

        except Exception as e:
            raise ValueError(f"Syntax Error line {line_idx + 1}: {e} inside '{line}'")

        return TagParseResult(step=step, consumed=True)

    def execute(self, step: dict, ctx: dict):
        if step.get("type") != "audio":
            return None

        session = ctx["session"]
        command = {"modifier": step["modifier"], "id": step["id"]}

        if step["modifier"] in ("sound", "music"):
            path = step["path"]
            
            # If it's a relative local route, check physical disk existence immediately
            if path.startswith("/") and not path.startswith("/assets"):
                relative_path = path.lstrip("/")
                absolute_audio_path = os.path.join(ASSETS_DIR, relative_path)
                
                # Rigid verification layer: force 422 engine panic if file is missing
                if not os.path.exists(absolute_audio_path):
                    raise HTTPException(
                        status_code=422,
                        detail={
                            "status": "AUDIO_ASSET_MISSING_ERROR",
                            "message": f"Required audio track asset not found on backend server: {path}",
                            "details": f"Expected absolute target: {absolute_audio_path}"
                        }
                    )
                path = f"/assets{path}"
                
            elif path.startswith("/assets/"):
                relative_path = path.replace("/assets/", "")
                absolute_audio_path = os.path.join(ASSETS_DIR, relative_path)
                if not os.path.exists(absolute_audio_path):
                    raise HTTPException(
                        status_code=422,
                        detail={
                            "status": "AUDIO_ASSET_MISSING_ERROR",
                            "message": f"Required audio track asset not found on backend server: {path}"
                        }
                    )

            command.update({
                "path": path,
                "volume": self._resolve_payload(step["volume"], default_from=0.0),
                "pitch": self._resolve_payload(step["pitch"], default_from=1.0),
            })
            
        elif step["modifier"] == "modify":
            command.update({
                "volume": self._resolve_payload(step["volume"], default_from=None),
                "pitch": self._resolve_payload(step.get("pitch"), default_from=None) if step.get("pitch") is not None else None
            })

        session.setdefault("_pending_audio", []).append(command)
        return None

    def _resolve_payload(self, value, default_from):
        """
        Resolves raw data elements, evaluation structures, and dictionary ramps 
        into perfectly structured JSON payloads matching frontend context parameters.
        """
        if value is None:
            return None
            
        # If evaluate_step_parameters already expanded a Ramp instance into a dict,
        # return it directly as the target animation wire payload model.
        if isinstance(value, dict) and "to" in value:
            return value

        if isinstance(value, (int, float)):
            return {"value": float(value), "duration_ms": 0}

        if isinstance(value, str):
            from src.text_utils import parse_animated_value
            parsed = parse_animated_value(value, default_from=default_from)
            if parsed is not None:
                if isinstance(parsed, dict):
                    return parsed
                return {"value": float(parsed), "duration_ms": 0}

        fallback = float(default_from) if default_from is not None else 1.0
        return {"value": fallback, "duration_ms": 0}
