import re
import textwrap
import traceback
from fastapi import HTTPException
from src.tags.base import BaseTag, TagParseResult

class PythonTag(BaseTag):
    """
    Handles:
        [python] ... [/python]     multi-line block
        [python "code"/]           inline single-line block

    The parser recognises the opening and closing lines of a multi-line
    block, and the whole line for an inline block. The runtime executes
    the accumulated code inside the session environment.
    """
    name = "python"

    MULTILINE_OPEN = re.compile(r'^\[python\]\s*$')
    MULTILINE_CLOSE = re.compile(r'^\[/python\]\s*$')
    INLINE = re.compile(r'^\[python\s+"(.*)"\s*/?\]$')

    def parse(self, line: str, line_idx: int, ctx: dict) -> TagParseResult:
        # [python] and [/python] are handled by the parser's main loop
        # because they toggle an accumulator, not a scope stack. Signal
        # the parser to switch modes via ctx flags.
        if self.MULTILINE_OPEN.match(line):
            ctx["in_python_block"] = True
            ctx["python_accumulator"] = []
            return TagParseResult(consumed=True)

        if self.MULTILINE_CLOSE.match(line):
            ctx["in_python_block"] = False
            raw = "\n".join(ctx["python_accumulator"])
            code = textwrap.dedent(raw)
            return TagParseResult(
                step={"type": "python_exec", "code": code},
                consumed=True,
            )

        m = self.INLINE.match(line)
        if m:
            return TagParseResult(
                step={"type": "python_exec", "code": m.group(1)},
                consumed=True,
            )

        return TagParseResult(consumed=False)

    def execute(self, step: dict, ctx: dict):
        if step.get("type") != "python_exec":
            return None

        env = ctx["env"]
        try:
            exec(step["code"], {}, env)
        except Exception:
            trace = traceback.format_exc()
            raise HTTPException(
                status_code=422,
                detail={
                    "status": "SCRIPT_RUNTIME_ERROR",
                    "message": "Python step failed.",
                    "details": f"Code:\n{step['code']}\n\nTrace:\n{trace}",
                },
            )
        return None