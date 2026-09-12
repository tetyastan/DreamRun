import re
from src.tags.base import BaseTag, TagParseResult

class PassTag(BaseTag):
    """Handles [pass/] — deliberate no-op."""
    name = "pass"
    PATTERN = re.compile(r'^\[pass\s*/\]$')

    def parse(self, line, line_idx, ctx):
        if not self.PATTERN.match(line):
            return TagParseResult(consumed=False)
        return TagParseResult(step={"type": "pass"}, consumed=True)

    def execute(self, step, ctx):
        if step.get("type") != "pass":
            return None
        return None


class NextTag(BaseTag):
    """
    Handles [next "file"/] — full act swap.

    The runtime replaces cached_steps with the parsed contents of the
    new act, clears the return stack, and stops the current batch so
    the client receives a clean boundary.
    """
    name = "next"
    PATTERN = re.compile(r'^\[next\s+"(.*)"\s*/?\]$')

    def parse(self, line, line_idx, ctx):
        m = self.PATTERN.match(line)
        if not m:
            return TagParseResult(consumed=False)
        return TagParseResult(
            step={"type": "change_act", "next_act_path": m.group(1).strip()},
            consumed=True,
        )

    def execute(self, step, ctx):
        if step.get("type") != "change_act":
            return None
        return "change_act"  # signal the runtime to perform the swap


class JumpTag(BaseTag):
    """
    Handles [jump ref/] — subroutine call with a return frame.

    The runtime pushes the current execution position onto the
    return_stack, copies the referenced block into cached_steps,
    and continues. When the block ends, the frame is popped and
    execution resumes from where it left off.
    """
    name = "jump"
    PATTERN = re.compile(r'^\[jump\s+([A-Za-z_][A-Za-z0-9_]*)\s*/?\]$')

    def parse(self, line, line_idx, ctx):
        m = self.PATTERN.match(line)
        if not m:
            return TagParseResult(consumed=False)
        return TagParseResult(
            step={"type": "jump", "target": m.group(1).strip()},
            consumed=True,
        )

    def execute(self, step, ctx):
        if step.get("type") != "jump":
            return None
        return "jump"


class GotoTag(BaseTag):
    """
    Handles [goto ref/] — unconditional jump without a return frame.

    Unlike [jump], the runtime does NOT push onto return_stack. When
    the referenced block ends, execution simply stops there (usually
    after its own [next] tag).
    """
    name = "goto"
    PATTERN = re.compile(r'^\[goto\s+([A-Za-z_][A-Za-z0-9_]*)\s*/?\]$')

    def parse(self, line, line_idx, ctx):
        m = self.PATTERN.match(line)
        if not m:
            return TagParseResult(consumed=False)
        return TagParseResult(
            step={"type": "goto", "target": m.group(1).strip()},
            consumed=True,
        )

    def execute(self, step, ctx):
        if step.get("type") != "goto":
            return None
        return "goto"

class PauseTag(BaseTag):
    """
    Handles the [pause ...] expression tag with an optional bypass block:
    
        [pause 2000/]
        [pause 2000 block/]
    
    Clamps sequence iteration steps on the frontend client timeline.
    If 'block' argument is present, user-driven click skips are explicitly prevented.
    """
    name = "pause"

    # Match format [pause 2000/] or [pause 2000 block/]
    PATTERN = re.compile(r'^\[pause\s+(?P<duration>\d+)(?:\s+(?P<block>block))?/\]$')

    def parse(self, line: str, line_idx: int, ctx: dict) -> TagParseResult:
        m = self.PATTERN.match(line)
        if not m:
            return TagParseResult(consumed=False)

        duration_ms = int(m.group("duration"))
        is_blocked = m.group("block") is not None

        step = {
            "type": "pause",
            "duration": duration_ms,
            "block": is_blocked
        }

        return TagParseResult(step=step, consumed=True)

    def execute(self, step: dict, ctx: dict):
        if step.get("type") != "pause":
            return None
            
        # Return a trigger tuple to force the runtime loop to emit this structural frame
        return ("frame", step)
