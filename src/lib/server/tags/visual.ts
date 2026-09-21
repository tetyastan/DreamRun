import fs from 'node:fs';
import path from 'node:path';
import { BaseTag, TagParseResult, type ExecResult } from './base.js';
import type { Step, ExecContext, ParseContext, ImageCommand } from '../types.js';
import { ASSETS_DIR } from '../config.js';
import { AssetMissingError } from '../errors.js';

/**
 * Handles the [image ...] family:
 *
 *     [image show "path" id layer "container.css" "image.css"/]
 *     [image modify "path" id layer "container.css" "image.css"/]
 *     [image hide id/]
 *
 * Commands are staged on session._pending_images and attached to the
 * next visible frame. Paths are validated against the filesystem; a
 * missing image or CSS file raises AssetMissingError.
 *
 * The last two arguments are optional. When omitted, no CSS is
 * attached and the client falls back to the default container styles.
 */
export class ImageTag extends BaseTag {
    name = 'image';

    private readonly SHOW =
        /^\[image\s+show\s+(?:"([^"]+)"|\{([A-Za-z0-9_.]+)\})\s+([A-Za-z0-9_{}.]+)\s+([A-Za-z0-9_{}]+)(?:\s+(?:"([^"]*)"|\{([A-Za-z0-9_.]+)\}))?(?:\s+(?:"([^"]*)"|\{([A-Za-z0-9_.]+)\}))?\s*\/?\]$/;

    private readonly MODIFY =
        /^\[image\s+modify\s+(?:"([^"]*)"|\{([A-Za-z0-9_.]+)\})\s+([A-Za-z0-9_{}.]+)\s+([A-Za-z0-9_{}]+)(?:\s+(?:"([^"]*)"|\{([A-Za-z0-9_.]+)\}))?(?:\s+(?:"([^"]*)"|\{([A-Za-z0-9_.]+)\}))?\s*\/?\]$/;

    private readonly HIDE =
        /^\[image\s+hide\s+([A-Za-z0-9_{}.]+)\s*\/?\]$/;

    parse(line: string, _lineIdx: number, _ctx: ParseContext): TagParseResult {
        const show = this.SHOW.exec(line);
        if (show) {
            return new TagParseResult({
                step: {
                    type: 'image',
                    modifier: 'show',
                    img_path: show[1] ?? show[2] ?? '',
                    id: show[3],
                    layer: show[4],
                    container_css: show[5] ?? show[6] ?? '',
                    image_css: show[7] ?? show[8] ?? '',
                },
                consumed: true,
            });
        }

        const modify = this.MODIFY.exec(line);
        if (modify) {
            return new TagParseResult({
                step: {
                    type: 'image',
                    modifier: 'modify',
                    img_path: modify[1] ?? modify[2] ?? '',
                    id: modify[3],
                    layer: modify[4],
                    container_css: modify[5] ?? modify[6] ?? '',
                    image_css: modify[7] ?? modify[8] ?? '',
                },
                consumed: true,
            });
        }

        const hide = this.HIDE.exec(line);
        if (hide) {
            return new TagParseResult({
                step: { type: 'image', modifier: 'hide', id: hide[1] },
                consumed: true,
            });
        }

        return new TagParseResult({ consumed: false });
    }

    execute(step: Step, ctx: ExecContext): ExecResult {
        if (step.type !== 'image') return null;

        const session = ctx.session;
        const command: ImageCommand = {
            modifier: step.modifier as ImageCommand['modifier'],
            id: step.id as string,
        };

        if (step.modifier === 'show' || step.modifier === 'modify') {
            const rawPath = step.img_path as string | null;
            if (rawPath) {
                command.img_path = resolveImagePath(rawPath);
            }

            // Layer may be a plain number or a {var} that resolved to a
            // string. Anything unparseable falls back to 10.
            const rawLayer = step.layer;
            if (typeof rawLayer === 'number') {
                command.layer = rawLayer;
            } else if (typeof rawLayer === 'string') {
                const parsed = parseInt(rawLayer, 10);
                command.layer = Number.isFinite(parsed) ? parsed : 10;
            } else {
                command.layer = 10;
            }

            command.container_css = resolveCssPath(step.container_css as string | null);
            command.image_css = resolveCssPath(step.image_css as string | null);
        }

        session._pending_images.push(command);
        return null;
    }
}

/**
 * Resolves an image path to a URL under /assets/... and verifies that
 * the file exists. Absolute http(s) URLs are passed through untouched.
 */
function resolveImagePath(rawPath: string): string {
    if (!rawPath || rawPath === 'none') return '';
    if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) {
        return rawPath;
    }
    if (rawPath.startsWith('/assets/')) {
        const abs = path.join(ASSETS_DIR, rawPath.replace('/assets/', ''));
        if (!fs.existsSync(abs)) {
            throw new AssetMissingError('IMAGE', rawPath, abs);
        }
        return rawPath;
    }
    if (rawPath.startsWith('/')) {
        const abs = path.join(ASSETS_DIR, rawPath.replace(/^\//, ''));
        if (!fs.existsSync(abs)) {
            throw new AssetMissingError('IMAGE', rawPath, abs);
        }
        return `/assets${rawPath}`;
    }
    return rawPath;
}

/**
 * Same as resolveImagePath, but returns null for empty values so the
 * client does not attempt to load an empty stylesheet.
 */
function resolveCssPath(rawPath: string | null): string | null {
    if (!rawPath || rawPath === 'none' || rawPath.trim() === '') return null;

    if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) {
        return rawPath;
    }

    let relative: string;
    if (rawPath.startsWith('/assets/')) {
        relative = rawPath.replace('/assets/', '');
    } else {
        relative = rawPath.replace(/^\//, '');
    }

    const abs = path.join(ASSETS_DIR, relative);
    if (!fs.existsSync(abs)) {
        throw new AssetMissingError('VISUAL', rawPath, abs);
    }

    return rawPath.startsWith('/assets/') ? rawPath : `/assets${rawPath.startsWith('/') ? '' : '/'}${rawPath}`;
}