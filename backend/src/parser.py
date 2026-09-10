import os
from src.tags import PARSERS
from src.tags.base import TagParseResult


def parse_dreamrun_blocks(file_path: str) -> dict:
    """
    Parses a .dreamrun scenario file into an executable step list.
    Delegates line recognition to the tag registry in src/tags/.
    """
    if not os.path.exists(file_path):
        return None

    main_steps = []
    references_map = {}

    with open(file_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    # Parser-level context shared with every tag.
    ctx = {
        "scope_stack": [],
        "in_python_block": False,
        "python_accumulator": [],
        "_references_map": references_map,
        "_main_steps_ref": main_steps,
    }

    for line_idx, raw_line in enumerate(lines):
        line = raw_line.strip()

        # Multi-line Python accumulation takes priority over everything.
        if ctx["in_python_block"]:
            if line == "[/python]":
                pass
            else:
                ctx["python_accumulator"].append(raw_line.rstrip("\r\n"))
                continue

        if not line or line.startswith("#"):
            continue

        handled = False
        for tag in PARSERS:
            result: TagParseResult = tag.parse(line, line_idx, ctx)

            if result.scope_open:
                ctx["scope_stack"].append(result.scope_open)

            if result.scope_close:
                _close_scope(ctx, result.scope_close, line_idx)

            if result.step:
                _route_step(ctx, result.step, main_steps)

            if result.consumed:
                handled = True
                break

        if not handled:
            raise ValueError(
                f"Engine Compilation Exception at line {line_idx + 1}: "
                f"Unrecognized syntax expression context token: '{line}'"
            )

    if ctx["scope_stack"]:
        raise ValueError(
            f"Syntax Error: Unclosed tags remaining: "
            f"{[s['type'] for s in ctx['scope_stack']]}"
        )

    return {"steps": main_steps, "references": references_map}


def _route_step(ctx: dict, step: dict, main_steps: list) -> None:
    stack = ctx["scope_stack"]
    if stack:
        top = stack[-1]
        if top["type"] == "ref":
            top["steps"].append(step)
            return
        if top["type"] == "answer_paired":
            top["children"].append(step)
            return
        if top["type"] == "if_builder":
            top["current_branch_steps"].append(step)
            return
    main_steps.append(step)


def _close_scope(ctx: dict, expected_type: str, line_idx: int) -> None:
    stack = ctx["scope_stack"]
    if not stack or stack[-1]["type"] != expected_type:
        raise ValueError(
            f"Syntax Error line {line_idx + 1}: "
            f"Mismatched closing tag for scope '{expected_type}'."
        )

    frame = stack.pop()

    if frame["type"] == "ref":
        if not frame["steps"]:
            raise ValueError(
                f"Syntax Error: Reference block '{frame['name']}' cannot be empty."
            )
        ctx.setdefault("_references_map", {})[frame["name"]] = frame["steps"]
        return

    if frame["type"] == "choice":
        step = {"type": "choice", "options": frame["answers"]}
        _route_step(ctx, step, ctx["_main_steps_ref"])
        return

    if frame["type"] == "answer_paired":
        for s in reversed(stack):
            if s["type"] == "choice":
                s["answers"].append({
                    "text": frame["text"],
                    "type": "paired",
                    "branches": frame["children"],
                })
                return
        raise ValueError(
            f"Syntax Error line {line_idx + 1}: Broken answer scope tracking."
        )

    if frame["type"] == "if_builder":
        frame["branches"].append({
            "mode": frame["current_branch_type"],
            "condition": frame["current_branch_expr"],
            "steps": frame["current_branch_steps"],
        })
        step = {"type": "conditional_block", "branches": frame["branches"]}
        _route_step(ctx, step, ctx["_main_steps_ref"])
        return
