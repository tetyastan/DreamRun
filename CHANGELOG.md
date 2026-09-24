# Changelog

All notable changes to the DreamRun engine are documented in this file.

The format is based on [https://keepachangelog.com/en/1.1.0/@LINKMID@Keep a Changelog](), and this project adheres to [https://semver.org/spec/v2.0.0.html@LINKMID@Semantic Versioning]().

## About versions before 3.1.0

Versions before 3.1.0 are not listed here. At those stages the engine had not
yet reached a stable shape: the public interfaces — the `.dreamrun`
syntax, the save format, and the client API — were still being redesigned, and
the engine had no defined method of practical use. No official description was
ever produced for them.

Those earlier commits remain accessible in the repository history, but this
changelog does not describe them.

## Unreleased

## 3.1.1 — 2026-09-24

### Fixed

- File `.saves.json` added to gitignore.

## 3.1.0 — 2026-09-21

The first release with a stable, documented public interface. From this point
forward, the engine has three contracts that consumers can rely on:

- the `.dreamrun` scenario syntax,
- the `.dreamsave` save format,
- the `GameState` client API.

### Added

- `.dreamrun` scripting language with dialogue, choices,
  conditionals, subroutines, jumps, pauses, image layers, and audio commands.
- Expression evaluation: `{variable}` interpolation in dialogue
  and inline TypeScript and Python blocks.
- `Character` and `Ramp` runtime types exposed to
  scenario authors.
- Audio subsystem built on the Web Audio API: gapless looping,
  sample-accurate ramps, click-free fade transitions.
- Layered image system with per-layer CSS attachments.
- Save system with nine visible slots per page and up to twenty pages.
- Settings screen with text speed and master volume.
- Error screen with copyable diagnostics.
- Loading overlay with debounced appearance for slow networks.

### Notes

- The engine runs as a SvelteKit application on Node.js.
- Python blocks execute in a browser-side Pyodide sandbox.
- Configuration files under `static/config/` are loaded as
  ES modules.