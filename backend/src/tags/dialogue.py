import re
from src.tags.base import BaseTag, TagParseResult
from src.text_utils import clean_dialogue_text
from src.core import Character


class VariableSpeakerTag(BaseTag):
    """Handles :var: > "text" — speaker resolved from the runtime env."""
    name = "dialogue.variable"
    PATTERN = re.compile(r'^:([A-Za-z_][A-Za-z0-9_]*):\s*>\s*(.*)$')

    def parse(self, line, line_idx, ctx):
        m = self.PATTERN.match(line)
        if not m:
            return TagParseResult(consumed=False)
        return TagParseResult(
            step={
                "type": "dialogue",
                "speaker_mode": "variable",
                "key": m.group(1),
                "raw_text": clean_dialogue_text(m.group(2)), # Ensured field consistency
            },
            consumed=True,
        )

    def execute(self, step, ctx):
        if step.get("type") != "dialogue" or step.get("speaker_mode") != "variable":
            return None
        env = ctx["env"]
        key = step["key"]
        if key in env and isinstance(env[key], Character):
            name = env[key].name
        else:
            name = key
        return ("frame", _build_frame(step, name, ctx))


class LiteralSpeakerTag(BaseTag):
    """Handles Name > "text" — literal speaker name."""
    name = "dialogue.literal"
    PATTERN = re.compile(r'^([^>]+)>\s*(.*)$')

    def parse(self, line, line_idx, ctx):
        if line.startswith(">"):
            return TagParseResult(consumed=False)
        m = self.PATTERN.match(line)
        if not m:
            return TagParseResult(consumed=False)
        return TagParseResult(
            step={
                "type": "dialogue",
                "speaker_mode": "literal",
                "name": m.group(1).strip(),
                "raw_text": clean_dialogue_text(m.group(2)), # Ensured field consistency
            },
            consumed=True,
        )

    def execute(self, step, ctx):
        if step.get("type") != "dialogue" or step.get("speaker_mode") != "literal":
            return None
        return ("frame", _build_frame(step, step["name"], ctx))


class NarratorTag(BaseTag):
    """Handles > "text" — narrator line, no name box."""
    name = "dialogue.narrator"

    def parse(self, line, line_idx, ctx):
        if not line.startswith(">"):
            return TagParseResult(consumed=False)
        return TagParseResult(
            step={
                "type": "dialogue",
                "speaker_mode": "narrator",
                "raw_text": clean_dialogue_text(line[1:].strip()), # Ensured field consistency
            },
            consumed=True,
        )

    def execute(self, step, ctx):
        if step.get("type") != "dialogue" or step.get("speaker_mode") != "narrator":
            return None
        return ("frame", _build_frame(step, None, ctx))


def _build_frame(step, name, ctx):
    """
    Build the final streamlined dialogue frame for the client.
    Performs standard dynamic python template evaluation and template variable interpolation.
    """
    env = ctx["env"]
    resolved_text = step["raw_text"]

    if resolved_text:
        try:
            # Flatten environmental state dictionary variables map safely into standard .format()
            formatting_map = {}
            for key, value in env.items():
                if key != "Character" and not isinstance(value, type):
                    # If the property resolves to an integer float value, clean the decimal point for display
                    if isinstance(value, float) and value.is_integer():
                        formatting_map[key] = int(value)
                    else:
                        formatting_map[key] = value

            resolved_text = resolved_text.format(**formatting_map)
        except Exception:
            # Fallback strategy: if lookup templates break, keep text untouched to avoid blank screen states
            pass

    return {
        "type": "dialogue",
        "name": name,
        "text": resolved_text, # Returns a plain clean string directly
        "bg": ctx["session"].get("_pending_bg"),
    }
