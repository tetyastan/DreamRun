import re
from src.tags.base import BaseTag, TagParseResult

class RefTag(BaseTag):
    """
    Handles [ref name] ... [/ref].

    Opening pushes a 'ref' scope frame onto the stack. Closing pops
    it and registers the collected steps in the references_map.
    Nested refs are forbidden.
    """
    name = "ref"
    OPEN = re.compile(r'^\[ref\s+([A-Za-z_][A-Za-z0-9_]*)\]$')
    CLOSE = re.compile(r'^\[/ref\]$')

    def parse(self, line, line_idx, ctx):
        m = self.OPEN.match(line)
        if m:
            for s in ctx["scope_stack"]:
                if s["type"] == "ref":
                    raise ValueError(
                        f"Syntax Error line {line_idx + 1}: "
                        f"Nested [ref] blocks are strictly forbidden."
                    )
            return TagParseResult(
                consumed=True,
                scope_open={
                    "type": "ref",
                    "name": m.group(1).strip(),
                    "steps": [],
                },
            )

        if self.CLOSE.match(line):
            return TagParseResult(consumed=True, scope_close="ref")

        return TagParseResult(consumed=False)


class ChoiceTag(BaseTag):
    """
    Handles [choice] ... [/choice].

    Opening pushes a 'choice' scope. Closing pops it and emits a
    single 'choice' step containing all collected answers.
    """
    name = "choice"
    OPEN = re.compile(r'^\[choice\]$')
    CLOSE = re.compile(r'^\[/choice\]$')

    def parse(self, line, line_idx, ctx):
        if self.OPEN.match(line):
            if ctx["scope_stack"] and ctx["scope_stack"][-1]["type"] == "ref":
                raise ValueError(
                    f"Syntax Error line {line_idx + 1}: "
                    f"[choice] cannot be nested inside a reference block."
                )
            return TagParseResult(
                consumed=True,
                scope_open={"type": "choice", "answers": []},
            )

        if self.CLOSE.match(line):
            if not ctx["scope_stack"] or ctx["scope_stack"][-1]["type"] != "choice":
                raise ValueError(
                    f"Syntax Error line {line_idx + 1}: Mismatched [/choice]."
                )
            return TagParseResult(consumed=True, scope_close="choice")

        return TagParseResult(consumed=False)


class AnswerTag(BaseTag):
    """
    Handles [answer "text"] ... [/answer].

    Opening pushes an 'answer_paired' scope. Closing pops it and
    attaches the collected body to the nearest enclosing choice,
    even if there is an [if] branch in between.
    """
    name = "answer"
    OPEN = re.compile(r'^\[answer\s+"([^"]+)"\]$')
    CLOSE = re.compile(r'^\[/answer\]$')

    def parse(self, line, line_idx, ctx):
        m = self.OPEN.match(line)
        if m:
            if not ctx["scope_stack"] or ctx["scope_stack"][-1]["type"] != "choice":
                raise ValueError(
                    f"Syntax Error line {line_idx + 1}: "
                    f"[answer] tags require an open [choice] parent block."
                )
            return TagParseResult(
                consumed=True,
                scope_open={
                    "type": "answer_paired",
                    "text": m.group(1).strip(),
                    "children": [],
                },
            )

        if self.CLOSE.match(line):
            if not ctx["scope_stack"] or ctx["scope_stack"][-1]["type"] != "answer_paired":
                raise ValueError(
                    f"Syntax Error line {line_idx + 1}: Mismatched [/answer]."
                )
            return TagParseResult(consumed=True, scope_close="answer_paired")

        return TagParseResult(consumed=False)