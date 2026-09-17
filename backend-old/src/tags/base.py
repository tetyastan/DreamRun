import re
from typing import Optional


class TagParseResult:
    """
    Result of a tag's attempt to parse a single script line.

    Attributes:
        step:       the executable step dict, or None if the tag
                    deferred to the next tag in the registry.
        consumed:   True if the tag fully claimed the line (even if it
                    produced no step, e.g. it opened a scope). False
                    means the parser should try the next tag.
        scope_open: If the tag opens a block ([ref], [choice], [if],
                    [answer]), this is a dict describing the new
                    scope frame. Otherwise None.
        scope_close: If the tag closes a block ([/ref], [/choice],
                    [/if], [/answer]), this is the expected scope
                    type as a string. Otherwise None.
        attach_to_scope: Optional callable that receives the current
                    scope stack and the produced step, letting the
                    tag decide where the step should be routed.
    """
    def __init__(
        self,
        step: Optional[dict] = None,
        consumed: bool = False,
        scope_open: Optional[dict] = None,
        scope_close: Optional[str] = None,
        attach_to_scope=None,
    ):
        self.step = step
        self.consumed = consumed
        self.scope_open = scope_open
        self.scope_close = scope_close
        self.attach_to_scope = attach_to_scope


class BaseTag:
    """
    Base class for all DreamRun tags.

    Subclasses declare a `name` (used in error messages), optionally
    override `parse` to recognize their source lines, and optionally
    override `execute` to handle their step dicts in the runtime.

    Registration:
        Tags are registered in `src/tags/__init__.py` via
        `register_parser(tag)` and `register_executor(tag)`. Order of
        registration defines priority: the first tag to claim a line
        wins, so specific tags must be registered before generic ones.

    Extending:
        To add a new tag:
          1. Create `src/tags/my_tag.py`.
          2. Subclass BaseTag.
          3. Implement `parse(self, line, line_idx, ctx) -> TagParseResult`.
          4. Optionally implement `execute(self, step, session, ctx) -> Any`.
          5. Register the instance in `src/tags/__init__.py`.

    Parse context (`ctx`):
        A small dict the parser passes to every tag. Currently:
            - "scope_stack": the live scope stack
            - "in_python_block": bool flag for the multi-line python block
        Tags must not mutate ctx directly unless explicitly documented.

    Execute context (`ctx`):
        Currently:
            - "session": the full session dict
            - "env":     the runtime environment (session["runtime_env"])
            - "dialogues": the accumulating list of visible frames
        A tag's `execute` may append to `dialogues`, mutate `session`,
        or return a control signal. See individual tags for details.
    """
    name: str = "base"

    def parse(self, line: str, line_idx: int, ctx: dict) -> TagParseResult:
        """
        Try to claim a single source line.

        Return TagParseResult(consumed=False) to defer to the next tag.
        Return TagParseResult(consumed=True) to claim the line, with or
        without producing a step.
        """
        return TagParseResult(consumed=False)

    def execute(self, step: dict, ctx: dict):
        """
        Execute a step produced by this tag (or by any tag).

        Return value semantics:
            None             -> step handled; continue to the next step
            "break"          -> stop the current batch (used by change_act)
            ("inject", lst)  -> inject lst of steps ahead of the pointer
            ("frame", dict)  -> emit a visible frame to the client
            ("pending_audio", cmd) -> stage an audio command on the session

        Tags that do not handle the given step type return None.
        """
        return None