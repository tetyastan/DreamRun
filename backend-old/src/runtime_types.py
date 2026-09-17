class Ramp:
    """
    Native proxy tracking smooth numeric value transitions inside the Python environment.
    Behaves as a regular float during calculations or conditions, but carries
    animation durations for visual/audio rendering endpoints.
    """
    def __init__(self, to_value: float, duration_ms: int, from_value: float = None):
        self.to_value = float(to_value)
        self.duration_ms = int(duration_ms)
        self.from_value = float(from_value) if from_value is not None else None

    def serialize(self) -> dict:
        """Transforms the Ramp transition lifecycle matrix into frontend wire models."""
        payload = {
            "to": self.to_value,
            "duration_ms": self.duration_ms
        }
        if self.from_value is not None:
            payload["from"] = self.from_value
        return payload

    # Emulate pure mathematical floats for smooth backend condition filtering
    def __float__(self): return self.to_value
    def __int__(self): return int(self.to_value)
    def __add__(self, other): return float(self) + float(other)
    def __radd__(self, other): return float(other) + float(self)
    def __sub__(self, other): return float(self) - float(other)
    def __rsub__(self, other): return float(other) - float(self)
    def __mul__(self, other): return float(self) * float(other)
    def __rmul__(self, other): return float(other) * float(self)
    def __truediv__(self, other): return float(self) / float(other)
    def __rtruediv__(self, other): return float(other) / float(self)
    def __lt__(self, other): return float(self) < float(other)
    def __le__(self, other): return float(self) <= float(other)
    def __gt__(self, other): return float(self) > float(other)
    def __ge__(self, other): return float(self) >= float(other)
    def __eq__(self, other): return float(self) == float(other)
    def __repr__(self): return f"Ramp(to={self.to_value}, duration={self.duration_ms}ms)"
