import os
import re
from src.tags.base import BaseTag, TagParseResult
from src.config import ASSETS_DIR

class BackgroundTag(BaseTag):
    """
    Handles [bg "path"/].

    Stores the background path in the runtime's pending_bg slot; the
    next visible frame (dialogue or choice) picks it up. Missing files
    are marked with MISSING:<basename> so the client can show a
    placeholder instead of a broken image.
    """
    name = "bg"

    PATTERN = re.compile(r'^\[bg\s+"(.*)"\s*/?\]$')

    def parse(self, line: str, line_idx: int, ctx: dict) -> TagParseResult:
        m = self.PATTERN.match(line)
        if not m:
            return TagParseResult(consumed=False)

        target = m.group(1).strip()
        if target.startswith("/"):
            target = f"/assets{target}"
        return TagParseResult(
            step={"type": "bg", "value": target},
            consumed=True,
        )

    def execute(self, step: dict, ctx: dict):
        if step.get("type") != "bg":
            return None
        # Stage the background; the parser's runtime will attach it to
        # the next visible frame.
        ctx["session"]["_pending_bg"] = step["value"]
        return None

    @staticmethod
    def validate(path: str) -> str:
        """
        Return the path unchanged if the asset exists on disk, or a
        MISSING:<basename> marker if it does not. Used by the runtime
        when building visible frames.
        """
        if not path:
            return path
        if path.startswith("/assets/"):
            relative = path.replace("/assets/", "")
            absolute = os.path.join(ASSETS_DIR, relative)
            if not os.path.exists(absolute):
                return f"MISSING:{os.path.basename(path)}"
        return path