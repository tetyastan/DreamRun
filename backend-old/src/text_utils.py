import re
from src.config import REMOVE_QUOTATION_MARKS

# Numeric payloads pattern mapping for tags execution (like [audio]):
#   "0.04"               plain value
#   "0.04~2000"          short animation (from current/default to 0.04)
#   "0..0.04 : 2000"     full explicit animation boundaries ramp
ANIMATION_PATTERN = re.compile(
    r'^\s*'
    r'(?P<from>-?\d+(?:\.\d+)?)?'
    r'\.\.'
    r'(?P<to>-?\d+(?:\.\d+)?)?'
    r'\s*:\s*'
    r'(?P<duration>\d+)'
    r'\s*$'
)

ANIMATION_SHORT_PATTERN = re.compile(
    r'^\s*'
    r'(?P<to>-?\d+(?:\.\d+)?)'
    r'\s*~\s*'
    r'(?P<duration>\d+)'
    r'\s*$'
)


def parse_animated_value(raw: str, default_from: float = None):
    """
    Parse a numeric argument that may carry an animation descriptor.
    Used exclusively by system runtime tags like [audio], [bg] or sprites layers.
    """
    s = raw.strip()

    # Try processing as a plain static float number first
    try:
        return float(s)
    except ValueError:
        pass

    # Process short modifier form: VALUE~MILLIS
    short = ANIMATION_SHORT_PATTERN.match(s)
    if short:
        return {
            "from": default_from,
            "to": float(short.group("to")),
            "duration_ms": int(short.group("duration")),
        }

    # Process full explicit boundary form: [FROM]..[TO] : MILLIS
    full = ANIMATION_PATTERN.match(s)
    if full:
        fallback_baseline = default_from if default_from is not None else 0.0
        from_value = float(full.group("from")) if full.group("from") else fallback_baseline
        to_value = float(full.group("to")) if full.group("to") else fallback_baseline
        return {
            "from": from_value,
            "to": to_value,
            "duration_ms": int(full.group("duration")),
        }

    return None


def clean_dialogue_text(text: str) -> str:
    """Removes optional matching quotation marks surrounding dialogue text lines."""
    text = text.strip()
    if REMOVE_QUOTATION_MARKS:
        if (
            (text.startswith('"') and text.endswith('"')) or
            (text.startswith("'") and text.endswith("'"))
        ):
            return text[1:-1].strip()
    return text
