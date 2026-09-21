import type { BaseTag } from './base.js';

/**
 * Global list of registered tags. Order matters: parsing asks each
 * tag in order, and the first one to claim the line wins. The
 * bootstrap in tags/index.ts decides the order.
 */
export const ALL_TAGS: BaseTag[] = [];

export function registerTag(tag: BaseTag): void {
    ALL_TAGS.push(tag);
}