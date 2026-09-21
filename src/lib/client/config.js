/**
 * Client-visible engine configuration.
 *
 * This file is the developer-facing knob board for the novel. Every
 * value here is a project-level decision that the player should not
 * have to make, and that should not be changeable at runtime from
 * the UI.
 *
 * Anything that is a per-user runtime preference (text speed, volume
 * sliders) belongs on GameState instead. Anything that shapes how
 * the game is built or where it stores its data belongs here.
 */

/**
 * Where saves are read from and written to.
 *
 *   'local'  — .dreamsave files live in the browser's localStorage.
 *              No accounts, no backend, no cross-device sync. Works
 *              out of the box on a fresh checkout.
 *
 *   'server' — .dreamsave files are posted to /api/saves and
 *              retrieved from there. Requires an account system and
 *              a persistent store on the backend to be useful; the
 *              in-memory Map that ships with the template is a
 *              placeholder, not a production store.
 *
 * Change this line to switch the whole game from one mode to the
 * other. There is no UI toggle, and SaveMenu will not expose one.
 */
export const SAVE_STORAGE = 'local';

/**
 * Total number of save slots exposed to the player.
 *
 * Must be a multiple of SAVE_SLOTS_PER_PAGE. The grid is paginated,
 * so this number defines how many pages the slot browser has.
 */
export const SAVE_SLOTS_TOTAL = 20 * 9;

/**
 * Number of slots shown on one page of the SaveMenu grid.
 */
export const SAVE_SLOTS_PER_PAGE = 9;