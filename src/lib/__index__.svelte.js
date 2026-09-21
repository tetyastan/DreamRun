import { getContext, setContext } from 'svelte';
import { GameState } from './client/GameState.svelte'

const GAME_CONTEXT_KEY = Symbol('GAME_CONTEXT');

export function initGameContext() {
    return setContext(GAME_CONTEXT_KEY, new GameState());
}

export function useGameContext() {
    return getContext(GAME_CONTEXT_KEY);
}