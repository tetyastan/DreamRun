import type { PyodideInterface } from 'pyodide';

// Singleton promise. The Pyodide runtime is loaded at most once per
// Node process. Scenarios that use only [ts] never trigger the load.
let pyodidePromise: Promise<PyodideInterface> | null = null;

/**
 * Python code injected into every new Pyodide instance.
 *
 * Defines a Python-side Ramp class so that scenario authors can
 * construct ramps from [python] blocks. The JS-side Ramp class is
 * separate and lives in runtime_types.ts.
 */
const PYTHON_BOOTSTRAP = `
class Ramp:
    def __init__(self, to_value, duration_ms, from_value=None):
        self.to_value = float(to_value)
        self.duration_ms = int(duration_ms)
        self.from_value = float(from_value) if from_value is not None else None

    def serialize(self):
        payload = {"to": self.to_value, "duration_ms": self.duration_ms}
        if self.from_value is not None:
            payload["from"] = self.from_value
        return payload

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
`;

/**
 * Lazily loads Pyodide. The WASM runtime is only initialised the
 * first time a [python] block executes. Subsequent calls reuse the
 * same instance.
 */
export async function getPyodide(): Promise<PyodideInterface> {
    if (!pyodidePromise) {
        pyodidePromise = (async () => {
            const { loadPyodide } = await import('pyodide');
            const py = await loadPyodide();
            py.runPython(PYTHON_BOOTSTRAP);
            return py;
        })();
    }
    return pyodidePromise;
}

export function isPyodideLoaded(): boolean {
    return pyodidePromise !== null;
}