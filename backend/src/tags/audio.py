import os
import re
from src.tags.base import BaseTag, TagParseResult
from src.config import ASSETS_DIR
from src.text_utils import parse_animated_value


class AudioTag(BaseTag):
    """
    Handles the [audio ...] family:

        [audio sound "path" id "volume" "pitch"/]
        [audio music "path" id "volume" "pitch"/]
        [audio modify id "volume" "pitch"/]
        [audio pause id/]
        [audio resume id/]
        [audio stop id/]

    Volume and pitch default to 1.0 when omitted. The runtime validates
    that referenced asset files actually exist on disk and stages the
    command on the session's per-frame audio buffer.
    """
    name = "audio"

    PATTERN = re.compile(
        r'^\[audio\s+(sound|music|modify|pause|resume|stop)\s+(.+)\]$'
    )
    INIT_PATTERN = re.compile(
        r'^"([^"]+)"\s+([A-Za-z_][A-Za-z0-9_]*)'
        r'(?:\s+"([^"]+)")?(?:\s+"([^"]+)")?$'
    )
    MODIFY_PATTERN = re.compile(
        r'^([A-Za-z_][A-Za-z0-9_]*)\s+"([^"]+)"(?:\s+"([^"]+)")?$'
    )
    UTILITY_PATTERN = re.compile(r'^([A-Za-z_][A-Za-z0-9_]*)$')

    def parse(self, line: str, line_idx: int, ctx: dict) -> TagParseResult:
        m = self.PATTERN.match(line)
        if not m:
            return TagParseResult(consumed=False)

        modifier = m.group(1)
        args = m.group(2).rstrip("/").strip()
        step = {"type": "audio", "modifier": modifier}

        try:
            if modifier in ("sound", "music"):
                init = self.INIT_PATTERN.match(args)
                if not init:
                    raise ValueError("invalid audio initialization layout")
                path = init.group(1).strip()
                if path.startswith("/"):
                    path = f"/assets{path}"
                volume_raw = init.group(3) if init.group(3) else "1.0"
                pitch_raw = init.group(4) if init.group(4) else "1.0"
                step.update({
                    "path": path,
                    "id": init.group(2).strip(),
                    "volume": self._parse_value(volume_raw, default_from=0.0, line_idx=line_idx),
                    "pitch": self._parse_value(pitch_raw, default_from=1.0, line_idx=line_idx),
                })

            elif modifier == "modify":
                mod = self.MODIFY_PATTERN.match(args)
                if not mod:
                    raise ValueError("invalid audio modify layout")
                volume_raw = mod.group(2)
                pitch_raw = mod.group(3) if mod.group(3) else None
                step.update({
                    "id": mod.group(1).strip(),
                    "volume": self._parse_value(volume_raw, default_from=None, line_idx=line_idx),
                    "pitch": (
                        self._parse_value(pitch_raw, default_from=None, line_idx=line_idx)
                        if pitch_raw else None
                    ),
                })

            else:
                util = self.UTILITY_PATTERN.match(args)
                if not util:
                    raise ValueError("audio utility requires a valid unquoted id")
                step.update({"id": util.group(1).strip()})

        except ValueError as e:
            raise ValueError(f"Syntax Error line {line_idx + 1}: {e} in '{line}'")

        return TagParseResult(step=step, consumed=True)

    def execute(self, step: dict, ctx: dict):
        if step.get("type") != "audio":
            return None

        session = ctx["session"]
        command = {"modifier": step["modifier"], "id": step["id"]}

        if step["modifier"] in ("sound", "music"):
            path = step["path"]
            if path.startswith("/assets/"):
                relative = path.replace("/assets/", "")
                absolute = os.path.join(ASSETS_DIR, relative)
                if not os.path.exists(absolute):
                    path = f"MISSING:{os.path.basename(step['path'])}"
            command.update({
                "path": path,
                "volume": self._resolve(step["volume"], default_from=0.0),
                "pitch": self._resolve(step["pitch"], default_from=1.0),
            })
        elif step["modifier"] == "modify":
            command.update({
                "volume": self._resolve(step["volume"], default_from=None),
                "pitch": (
                    self._resolve(step["pitch"], default_from=None)
                    if step.get("pitch") is not None else None
                ),
            })
        elif step["modifier"] in ("pause", "resume", "stop"):
            # No numeric fields for these modifiers.
            pass

        session.setdefault("_pending_audio", []).append(command)
        return None


    def _resolve(self, value, default_from):
        """
        Turn a parsed numeric/animation value into a wire-ready dict.
        Supports leaving 'from' as None so the client can resolve it dynamically.
        """
        if isinstance(value, (int, float)):
            return {"value": float(value), "duration_ms": 0}

        if isinstance(value, dict):
            try:
                raw_from = value.get("from")
                from_v = float(raw_from) if raw_from is not None else None
                
                to_v = float(value["to"])
                dur = int(value["duration_ms"])
                
                if from_v is None:
                    return {"to": to_v, "duration_ms": dur}
                return {"from": from_v, "to": to_v, "duration_ms": dur}
            except (TypeError, ValueError, KeyError):
                # Fallback to default_from only if it's explicitly passed and valid
                fallback = float(default_from) if default_from is not None else 0.0
                return {"value": fallback, "duration_ms": 0}

        return {"value": float(default_from if default_from is not None else 0.0), "duration_ms": 0}
    
    def _parse_value(self, raw, default_from, line_idx):
        """
        Parse one numeric argument that may carry an animation descriptor.

        Returns either a float or a dict:
            {"from": f, "to": f, "duration_ms": n}

        Removed the 'else 0.0' fallback override logic to preserve None 
        so modify tags can accurately retain previous client-side volume states.
        """
        result = parse_animated_value(
            raw,
            default_from=default_from, # Explicitly pass default_from verbatim (can be None)
        )
        if result is None:
            raise ValueError(f"invalid numeric or animation argument: {raw!r}")
        return result
