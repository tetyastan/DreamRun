import { compileScript, dumpCompiled } from './compiler.js';

const script = compileScript();
console.log(dumpCompiled(script));