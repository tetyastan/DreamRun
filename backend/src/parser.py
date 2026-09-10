import os
import re
import textwrap
from src.config import REMOVE_QUOTATION_MARKS


def clean_dialogue_text(text: str) -> str:
    """
    Removes optional matching quotation marks surrounding dialogue text.

    Behaviour is controlled by REMOVE_QUOTATION_MARKS in src/config.py.
    Both `"..."` and `'...'` pairs are handled.
    """
    text = text.strip()
    if REMOVE_QUOTATION_MARKS:
        if (
            (text.startswith('"') and text.endswith('"')) or
            (text.startswith("'") and text.endswith("'"))
        ):
            return text[1:-1].strip()
    return text


def parse_dreamrun_blocks(file_path: str) -> dict:
    """
    Parses a .dreamrun scenario file into an executable step list.

    Returns a dictionary with two keys:
        - "steps":      ordered list of executable step dicts (main track).
        - "references": mapping of ref-name -> list of steps, isolated
                        from linear execution and only reachable via [jump].

    Quote policy (this version):
        - Strings that may contain spaces (paths, filenames, dialogue
          text, python code) are wrapped in double quotes.
        - Identifiers (ref names) are written WITHOUT quotes.
        - Python expressions in [if]/[elif] are written WITHOUT quotes.
        - Self-closing [answer "text" "<tag>"/] has been REMOVED.
          Use the paired [answer "text"] ... [/answer] form instead.

    Supported tags:

        [python] ... [/python]          multi-line Python block
        [python "code"/]                inline single-line Python
        [pass/]                         deliberate no-op
        [bg "path"/]                    background change
        [config "file"/]                import a Python config module
        [next "file"/]                  switch to another act file
        [jump ref/]                     subroutine call (returns)
        [goto ref/]                     unconditional jump (no return)
        [ref name] ... [/ref]           isolated subroutine definition
        [choice] ... [/choice]          branch menu
        [answer "text"] ... [/answer]   answer option with a body
        [if expr]                       conditional block opener
        [elif expr]                     alternate conditional branch
        [else]                          final fallback branch
        [/if]                           conditional block closer
        :var: > "text"                  variable speaker dialogue
        Name > "text"                   literal speaker dialogue
        > "text"                        narrator dialogue

    Scope rules:
        - [ref] blocks are never appended to `main_steps`. They only
          populate `references_map` and are entered on demand by the
          runtime's [jump] or [goto] handler. Nested [ref] blocks are
          forbidden.
        - [answer] blocks live strictly inside [choice] and are attached
          to the enclosing choice.
        - [if]/[elif]/[else] blocks are compiled into a single
          "conditional_block" step containing an ordered list of
          branches. The runtime evaluates branches top-to-bottom and
          executes the first one whose condition is truthy.
        - [choice] cannot be nested directly inside [ref].

    Missing file returns None; the caller decides how to report it.

    Any unrecognised token, mismatched closing tag, or unclosed
    scope raises ValueError with the offending line number.
    """
    # Missing file? Caller decides how to report the error.
    if not os.path.exists(file_path):
        return None

    main_steps = []
    references_map = {}

    with open(file_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    in_python_block = False
    python_block_accumulator = []
    scope_stack = []

    for line_idx, line in enumerate(lines):
        stripped = line.strip()

        # [python]
        # ...
        # [/python]
        # Multi-line Python block.
        #
        # Lines are preserved verbatim (only the trailing newline is
        # stripped) so that indentation inside the block stays valid.
        # textwrap.dedent then removes common leading whitespace.
        if stripped == "[python]":
            in_python_block = True
            python_block_accumulator = []
            continue

        if stripped == "[/python]":
            in_python_block = False
            raw_code = "\n".join(python_block_accumulator)
            cleaned_code = textwrap.dedent(raw_code)
            target_step = {"type": "python_exec", "code": cleaned_code}

            if scope_stack:
                if scope_stack[-1]["type"] == "ref":
                    scope_stack[-1]["steps"].append(target_step)
                elif scope_stack[-1]["type"] == "answer_paired":
                    scope_stack[-1]["children"].append(target_step)
                elif scope_stack[-1]["type"] == "if_builder":
                    scope_stack[-1]["current_branch_steps"].append(target_step)
            else:
                main_steps.append(target_step)
            continue

        if in_python_block:
            python_block_accumulator.append(line.rstrip("\r\n"))
            continue

        # Skip blank lines and standalone comments.
        if not stripped or stripped.startswith("#"):
            continue

        # append_step
        # Helper hook to route standard steps to correct open scopes safely.
        def append_step(step_node):
            if scope_stack:
                if scope_stack[-1]["type"] == "ref":
                    scope_stack[-1]["steps"].append(step_node)
                elif scope_stack[-1]["type"] == "answer_paired":
                    scope_stack[-1]["children"].append(step_node)
                elif scope_stack[-1]["type"] == "if_builder":
                    scope_stack[-1]["current_branch_steps"].append(step_node)
            else:
                main_steps.append(step_node)

        # [pass/]
        # Deliberate no-op.
        if stripped == "[pass/]":
            append_step({"type": "pass"})
            continue

        # [next "file"]
        # Switch to another act file. Filename is a string and stays quoted.
        next_match = re.match(r'^\[next\s+"(.*)"\s*/?\]$', stripped)
        if next_match:
            append_step({"type": "change_act", "next_act_path": next_match.group(1).strip()})
            continue

        # [jump ref/]
        # Subroutine call. Ref name is an identifier — NO quotes.
        jump_match = re.match(r'^\[jump\s+([A-Za-z_][A-Za-z0-9_]*)\s*/?\]$', stripped)
        if jump_match:
            append_step({"type": "jump", "target": jump_match.group(1).strip()})
            continue

        # [goto ref/]
        # Unconditional jump. Ref name is an identifier — NO quotes.
        goto_match = re.match(r'^\[goto\s+([A-Za-z_][A-Za-z0-9_]*)\s*/?\]$', stripped)
        if goto_match:
            append_step({"type": "goto", "target": goto_match.group(1).strip()})
            continue

        # [python "code"/]
        # Inline single-line Python. Code is a string and stays quoted.
        single_py_match = re.match(r'^\[python\s+"(.*)"\s*/?\]$', stripped)
        if single_py_match:
            append_step({"type": "python_exec", "code": single_py_match.group(1)})
            continue

        # [bg "path"/]
        # Change background. Path is a string and stays quoted.
        bg_match = re.match(r'^\[bg\s+"(.*)"\s*/?\]$', stripped)
        if bg_match:
            bg_target = bg_match.group(1).strip()
            if bg_target.startswith("/"):
                bg_target = f"/assets{bg_target}"
            append_step({"type": "bg", "value": bg_target})
            continue

        # [config "file"/]
        # Import a Python config module. Filename is a string and stays quoted.
        cfg_match = re.match(r'^\[config\s+"(.*)"\s*/?\]$', stripped)
        if cfg_match:
            filename = cfg_match.group(1).strip()
            if not filename.endswith(".py"):
                filename = f"{filename}.py"
            append_step({"type": "cfg_import", "filename": filename})
            continue

        # [if expr]
        # Opens a conditional block. Expression is a bare Python string — NO quotes.
        if_match = re.match(r'^\[if\s+(.+)\]$', stripped)
        if if_match:
            py_expr = if_match.group(1).strip()
            scope_stack.append({
                "type": "if_builder",
                "branches": [],
                "current_branch_type": "if",
                "current_branch_expr": py_expr,
                "current_branch_steps": []
            })
            continue

        # [elif expr] or [else if expr]
        # Alternate branch. Expression is bare Python — NO quotes.
        elif_match = re.match(r'^\[(?:elif|else\s+if)\s+(.+)\]$', stripped)
        if elif_match:
            if not scope_stack or scope_stack[-1]["type"] != "if_builder":
                raise ValueError(
                    f"Syntax Error line {line_idx + 1}: Unexpected '[elif]' tag "
                    f"without a matching open '[if]' context block."
                )

            builder = scope_stack[-1]
            if builder["current_branch_type"] == "else":
                raise ValueError(
                    f"Syntax Error line {line_idx + 1}: '[elif]' cannot come "
                    f"after an '[else]' block statement branch."
                )

            builder["branches"].append({
                "mode": builder["current_branch_type"],
                "condition": builder["current_branch_expr"],
                "steps": builder["current_branch_steps"]
            })

            py_expr = elif_match.group(1).strip()
            builder["current_branch_type"] = "elif"
            builder["current_branch_expr"] = py_expr
            builder["current_branch_steps"] = []
            continue

        # [else]
        # Final fallback branch. No argument allowed.
        if stripped == "[else]":
            if not scope_stack or scope_stack[-1]["type"] != "if_builder":
                raise ValueError(
                    f"Syntax Error line {line_idx + 1}: Unexpected '[else]' tag "
                    f"without an active '[if]' context block."
                )

            builder = scope_stack[-1]
            if builder["current_branch_type"] == "else":
                raise ValueError(
                    f"Syntax Error line {line_idx + 1}: Duplicate '[else]' statements "
                    f"are strictly forbidden inside a single conditional block."
                )

            builder["branches"].append({
                "mode": builder["current_branch_type"],
                "condition": builder["current_branch_expr"],
                "steps": builder["current_branch_steps"]
            })

            builder["current_branch_type"] = "else"
            builder["current_branch_expr"] = None
            builder["current_branch_steps"] = []
            continue

        # [/if]
        # Closing gate. Emits a single "conditional_block" step.
        if stripped == "[/if]":
            if not scope_stack or scope_stack[-1]["type"] != "if_builder":
                raise ValueError(f"Syntax Error line {line_idx + 1}: Mismatched standalone closed tag '[/if]'.")

            builder = scope_stack.pop()
            builder["branches"].append({
                "mode": builder["current_branch_type"],
                "condition": builder["current_branch_expr"],
                "steps": builder["current_branch_steps"]
            })

            conditional_step = {
                "type": "conditional_block",
                "branches": builder["branches"]
            }

            if scope_stack:
                if scope_stack[-1]["type"] == "ref":
                    scope_stack[-1]["steps"].append(conditional_step)
                elif scope_stack[-1]["type"] == "answer_paired":
                    scope_stack[-1]["children"].append(conditional_step)
            else:
                main_steps.append(conditional_step)
            continue

        # [ref name] ... [/ref]
        # Isolated subroutine. Name is an identifier — NO quotes.
        ref_open_match = re.match(r'^\[ref\s+([A-Za-z_][A-Za-z0-9_]*)\]$', stripped)
        if ref_open_match:
            if any(s["type"] == "ref" for s in scope_stack):
                raise ValueError(f"Syntax Error line {line_idx}: Nested [ref] blocks are strictly forbidden.")

            ref_name = ref_open_match.group(1).strip()
            scope_stack.append({
                "type": "ref",
                "name": ref_name,
                "steps": []
            })
            continue

        if stripped == "[/ref]":
            if not scope_stack or scope_stack[-1]["type"] != "ref":
                raise ValueError(f"Syntax Error line {line_idx}: Mismatched closed tag [/ref].")

            ref_meta = scope_stack.pop()
            if not ref_meta["steps"]:
                raise ValueError(f"Syntax Error: Reference block '{ref_meta['name']}' cannot be empty.")

            references_map[ref_meta["name"]] = ref_meta["steps"]
            continue

        # [choice] ... [/choice]
        if stripped == "[choice]":
            if scope_stack and scope_stack[-1]["type"] == "ref":
                raise ValueError(
                    f"Syntax Error line {line_idx}: [choice] cannot be nested "
                    f"inside a reference block directly."
                )
            scope_stack.append({"type": "choice", "answers": []})
            continue

        if stripped == "[/choice]":
            if not scope_stack or scope_stack[-1]["type"] != "choice":
                raise ValueError(f"Syntax Error line {line_idx}: Mismatched closed tag [/choice].")

            choice_meta = scope_stack.pop()
            target_step = {
                "type": "choice",
                "options": choice_meta["answers"]
            }
            append_step(target_step)
            continue

        # [answer "text"] ... [/answer]
        # Paired option. The text shown to the player stays quoted.
        # The self-closing [answer "text" "<tag>"/] form has been REMOVED
        # to eliminate quote-escaping entirely. Use the paired form.
        answer_paired_match = re.match(r'^\[answer\s+"([^"]+)"\]$', stripped)
        if answer_paired_match:
            if not scope_stack or scope_stack[-1]["type"] != "choice":
                raise ValueError(
                    f"Syntax Error line {line_idx}: [answer] tags require "
                    f"an open [choice] parent block."
                )

            ans_text = answer_paired_match.group(1).strip()
            scope_stack.append({"type": "answer_paired", "text": ans_text, "children": []})
            continue

        if stripped == "[/answer]":
            if not scope_stack or scope_stack[-1]["type"] != "answer_paired":
                raise ValueError(f"Syntax Error line {line_idx}: Mismatched closed tag [/answer].")

            paired_meta = scope_stack.pop()

            # Append the answer to the nearest enclosing [choice], even if
            # the [answer] sits inside an [if] branch inside that [choice].
            choice_parent = None
            for scope in reversed(scope_stack):
                if scope["type"] == "choice":
                    choice_parent = scope
                    break

            if not choice_parent:
                raise ValueError(f"Syntax Error line {line_idx + 1}: Broken answer scope tracking.")

            choice_parent["answers"].append({
                "text": paired_meta["text"],
                "type": "paired",
                "branches": paired_meta["children"]
            })
            continue

        # --- DIALOGUE LINES ---

        # :var: > "text"
        var_char_match = re.match(r'^:([A-Za-z_][A-Za-z0-9_]*):\s*>\s*(.*)$', stripped)
        if var_char_match:
            target_step = {
                "type": "dialogue",
                "speaker_mode": "variable",
                "key": var_char_match.group(1),
                "text": clean_dialogue_text(var_char_match.group(2))
            }
            append_step(target_step)
            continue

        # Name > "text"
        raw_char_match = re.match(r'^([^>]+)>\s*(.*)$', stripped)
        if raw_char_match and not stripped.startswith(">"):
            target_step = {
                "type": "dialogue",
                "speaker_mode": "literal",
                "name": raw_char_match.group(1).strip(),
                "text": clean_dialogue_text(raw_char_match.group(2))
            }
            append_step(target_step)
            continue

        # > "text"
        if stripped.startswith(">"):
            target_step = {
                "type": "dialogue",
                "speaker_mode": "narrator",
                "text": clean_dialogue_text(stripped[1:].strip())
            }
            append_step(target_step)
            continue

        # Unrecognised token.
        raise ValueError(
            f"Engine Compilation Exception at line {line_idx + 1}: "
            f"Unrecognized syntax expression context token: '{stripped}'"
        )

    if scope_stack:
        raise ValueError(
            f"Syntax Error: Unclosed tags remaining: "
            f"{[s['type'] for s in scope_stack]}"
        )

    return {"steps": main_steps, "references": references_map}