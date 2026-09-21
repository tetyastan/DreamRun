/**
 * Base class for errors that should reach the client as a structured
 * HTTP response rather than a bare 500.
 *
 * The FastAPI engine used HTTPException for this. In SvelteKit the
 * equivalent is a plain Error with a `toResponse()` method that the
 * route handlers know how to recognise.
 */
export class EngineError extends Error {
    status: string;
    httpStatus: number;
    details: string | null;

    constructor(
        status: string,
        message: string,
        details: string | null = null,
        httpStatus = 422,
    ) {
        super(message);
        this.name = 'EngineError';
        this.status = status;
        this.httpStatus = httpStatus;
        this.details = details;
    }

    /**
     * Serializes the error into the JSON envelope that the client
     * expects. Callers pass the returned object to `json()` from
     * `@sveltejs/kit`.
     */
    toResponse(): { status: number; body: unknown } {
        return {
            status: this.httpStatus,
            body: {
                detail: {
                    status: this.status,
                    message: this.message,
                    details: this.details ?? 'None',
                },
            },
        };
    }
}

/**
 * Raised when a scenario references a file that does not exist on disk.
 * Used by visual and audio tags for images, audio files, and CSS.
 */
export class AssetMissingError extends EngineError {
    constructor(kind: string, path: string, expected: string | null = null) {
        super(
            `${kind}_ASSET_MISSING_ERROR`,
            `Required ${kind.toLowerCase()} asset not found: ${path}`,
            expected ? `Expected absolute target: ${expected}` : null,
            422,
        );
        this.name = 'AssetMissingError';
    }
}

/**
 * Raised when a [config] file cannot be found under CONFIG_DIR.
 */
export class ConfigMissingError extends EngineError {
    constructor(path: string, expected: string | null = null) {
        super(
            'CONFIG_FILE_MISSING_ERROR',
            `Config file not found: ${path}`,
            expected ? `Expected absolute target: ${expected}` : null,
            422,
        );
        this.name = 'ConfigMissingError';
    }
}

/**
 * Raised when a [jump] or [goto] references a [ref] name that was
 * never declared in the current act or in any previously loaded act.
 */
export class ReferenceNotFoundError extends EngineError {
    constructor(target: string) {
        super(
            'REFERENCE_NOT_FOUND',
            `Reference tracking key '${target}' missing.`,
            null,
            422,
        );
        this.name = 'ReferenceNotFoundError';
    }
}

/**
 * Raised when a [next] tag points to an act file that does not exist.
 */
export class ChapterMissingError extends EngineError {
    constructor(name: string, expected: string | null = null) {
        super(
            'CHAPTER_MISSING_ERROR',
            `Next act chapter file '${name}' not found.`,
            expected ? `Expected target location: ${expected}` : null,
            404,
        );
        this.name = 'ChapterMissingError';
    }
}