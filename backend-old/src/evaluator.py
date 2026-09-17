import re
from src.runtime_types import Ramp

# Matches exact standalone python expressions wrapped in braces like {my_var} or {player.level}
EXPLICIT_EXPR_PATTERN = re.compile(r'^\{(?P<expr>[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\}$')
# Matches inline string interpolation brackets like /assets/audio/{track_name}.mp3
INLINE_BRACKETS_PATTERN = re.compile(r'\{([^}]+)\}')

def evaluate_step_parameters(step: dict, environment: dict) -> dict:
    """
    Recursively scans and processes compiled step fields. Resolves any 
    embedded execution parameters wrapped inside curly braces against the active runtime variables.
    """
    if isinstance(step, dict):
        return {k: evaluate_step_parameters(v, environment) for k, v in step.items()}
    elif isinstance(step, list):
        return [evaluate_step_parameters(v, environment) for v in step]
    elif isinstance(step, str):
        stripped = step.strip()
        
        # Standalone parameter evaluation (e.g. integer variables or Ramp objects)
        m = EXPLICIT_EXPR_PATTERN.match(stripped)
        if m:
            expr = m.group("expr")
            try:
                value = eval(expr, {}, environment)
                if isinstance(value, Ramp):
                    return value.serialize()
                return value
            except Exception:
                return f"UNRESOLVED_EXPR:{expr}"
                
        # Dynamic inline string interpolation evaluation
        if "{" in step and "}" in step:
            def replace_token(match):
                expr = match.group(1)
                try:
                    res = eval(expr, {}, environment)
                    # If a Ramp gets dropped into a string accidentally, fall back to its float target
                    if isinstance(res, Ramp):
                        return str(res.to_value)
                    return str(res)
                except Exception:
                    return f"{{UNRESOLVED:{expr}}}"
            return INLINE_BRACKETS_PATTERN.sub(replace_token, step)
            
        return step
    else:
        return step
