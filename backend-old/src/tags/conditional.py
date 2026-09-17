import re
from fastapi import HTTPException
from src.tags.base import BaseTag, TagParseResult


class ConditionalTag(BaseTag):
    """
    Handles [if expr], [elif expr], [else], [/if].

    Opening pushes an 'if_builder' scope. Each elif/else packages the
    previous branch and starts a new one. Closing packages the last
    branch and emits a single 'conditional_block' step.

    Conditions are bare Python expressions (no [python "..."] wrapper).
    The runtime evaluates them with eval() inside the session env.
    """
    name = "conditional"

    IF = re.compile(r'^\[if\s+(.+)\]$')
    ELIF = re.compile(r'^\[(?:elif|else\s+if)\s+(.+)\]$')
    ELSE = re.compile(r'^\[else\]$')
    CLOSE = re.compile(r'^\[/if\]$')

    def parse(self, line, line_idx, ctx):
        stack = ctx["scope_stack"]

        m = self.IF.match(line)
        if m:
            return TagParseResult(
                consumed=True,
                scope_open={
                    "type": "if_builder",
                    "branches": [],
                    "current_branch_type": "if",
                    "current_branch_expr": m.group(1).strip(),
                    "current_branch_steps": [],
                },
            )

        m = self.ELIF.match(line)
        if m:
            if not stack or stack[-1]["type"] != "if_builder":
                raise ValueError(
                    f"Syntax Error line {line_idx + 1}: "
                    f"Unexpected [elif] without an open [if]."
                )
            builder = stack[-1]
            if builder["current_branch_type"] == "else":
                raise ValueError(
                    f"Syntax Error line {line_idx + 1}: "
                    f"[elif] cannot come after [else]."
                )
            builder["branches"].append({
                "mode": builder["current_branch_type"],
                "condition": builder["current_branch_expr"],
                "steps": builder["current_branch_steps"],
            })
            builder["current_branch_type"] = "elif"
            builder["current_branch_expr"] = m.group(1).strip()
            builder["current_branch_steps"] = []
            return TagParseResult(consumed=True)

        if self.ELSE.match(line):
            if not stack or stack[-1]["type"] != "if_builder":
                raise ValueError(
                    f"Syntax Error line {line_idx + 1}: "
                    f"Unexpected [else] without an open [if]."
                )
            builder = stack[-1]
            if builder["current_branch_type"] == "else":
                raise ValueError(
                    f"Syntax Error line {line_idx + 1}: "
                    f"Duplicate [else] in a single conditional block."
                )
            builder["branches"].append({
                "mode": builder["current_branch_type"],
                "condition": builder["current_branch_expr"],
                "steps": builder["current_branch_steps"],
            })
            builder["current_branch_type"] = "else"
            builder["current_branch_expr"] = None
            builder["current_branch_steps"] = []
            return TagParseResult(consumed=True)

        if self.CLOSE.match(line):
            if not stack or stack[-1]["type"] != "if_builder":
                raise ValueError(
                    f"Syntax Error line {line_idx + 1}: Mismatched [/if]."
                )
            return TagParseResult(consumed=True, scope_close="if_builder")

        return TagParseResult(consumed=False)

    def execute(self, step, ctx):
        if step.get("type") != "conditional_block":
            return None

        env = ctx["env"]
        selected = None

        for branch in step["branches"]:
            if branch["mode"] in ("if", "elif"):
                try:
                    result = bool(eval(branch["condition"], {}, env))
                except Exception as e:
                    raise HTTPException(
                        status_code=422,
                        detail={
                            "status": "CONDITIONAL_EVAL_ERROR",
                            "message": f"Failed to evaluate condition: {branch['condition']}",
                            "details": str(e),
                        },
                    )
            else:
                result = True

            if result:
                selected = branch
                break

        if selected:
            return ("inject", selected["steps"])
        return None