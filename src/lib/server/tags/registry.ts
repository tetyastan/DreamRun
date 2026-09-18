import type { BaseTag } from './base.js';

export const ALL_TAGS: BaseTag[] = [];

export function registerTag(tag: BaseTag): void {
    ALL_TAGS.push(tag);
}