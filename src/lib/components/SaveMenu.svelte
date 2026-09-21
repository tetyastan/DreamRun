<!-- src/lib/components/SaveMenu.svelte -->
<script>
    import './SaveMenu.css';
    import { useGameContext } from '$lib/__index__.svelte';
    import {
        SAVE_STORAGE,
        SAVE_SLOTS_PER_PAGE,
        SAVE_SLOTS_TOTAL,
    } from '$lib/client/config.js';
    import { onMount } from 'svelte';

    const game = useGameContext();

    let page = $state(0);
    let slots = $state(new Array(SAVE_SLOTS_TOTAL).fill(null));

    const totalPages = Math.ceil(SAVE_SLOTS_TOTAL / SAVE_SLOTS_PER_PAGE);

    /**
     * Whether the Save tab should be offered at all.
     *
     * Saving requires a live session: the server assembles a snapshot
     * from the current playthrough state, and without a session there
     * is nothing to snapshot. This is derived from GameState rather
     * than from where the SaveMenu was opened, because the invariant
     * is the same regardless of navigation path.
     */
    let canSave = $derived(game.isGameStarted);

    /**
     * Reloads the slot list from the server via the game socket.
     *
     * Slot listing used to be a REST call to /api/saves. That endpoint
     * no longer exists — all gameplay traffic goes through the WebSocket
     * now. The list is fetched by sending a `list_saves` message and
     * awaiting the `saves_list` reply through GameState.
     */
    async function refresh() {
        const result = await game.listSaves();
        if (!result.ok) return;
        const next = new Array(SAVE_SLOTS_TOTAL).fill(null);
        for (const { slot, metadata } of result.saves) next[slot] = metadata;
        slots = next;
    }

    onMount(refresh);

    /**
     * If SaveMenu is opened from the main menu, there is no session
     * and saving is impossible. Force the menu into LOAD mode so the
     * grid does not sit on a hidden tab.
     */
    $effect(() => {
        if (!canSave && game.saveMenuMode === 'SAVE') {
            game.saveMenuMode = 'LOAD';
        }
    });

    function slotNumber(localIdx) {
        return page * SAVE_SLOTS_PER_PAGE + localIdx;
    }

    function formatDate(ts) {
        return new Date(ts).toLocaleString();
    }

    async function onSlotClick(localIdx) {
        const slot = slotNumber(localIdx);
        if (game.saveMenuMode === 'SAVE') {
            await game.saveGame(slot);
            await refresh();
        } else if (slots[slot]) {
            if (game.audioManager && typeof game.audioManager.initialize === 'function') {
                await game.audioManager.initialize();
            }
            
            // loadGame flips currentScreen to 'GAME' on success, so
            // saveMenuReturnTo does not need to be consulted here.
            await game.loadGame(slot);
        }
    }

    function nextPage() { if (page < totalPages - 1) page++; }
    function prevPage() { if (page > 0) page--; }

    function goBack() {
        game.currentScreen = game.saveMenuReturnTo;
    }
</script>

<main class="container save-container">
    <header class="save-header">
        <button
            class="tab"
            class:active={game.saveMenuMode === 'LOAD'}
            onclick={() => game.saveMenuMode = 'LOAD'}
        >Load</button>
        {#if canSave}
            <button
                class="tab"
                class:active={game.saveMenuMode === 'SAVE'}
                onclick={() => game.saveMenuMode = 'SAVE'}
            >Save</button>
        {/if}
    </header>

    <div class="save-grid">
        {#each Array(SAVE_SLOTS_PER_PAGE) as _, i}
            {@const slot = slotNumber(i)}
            {@const meta = slots[slot]}
            <button
                class="slot"
                class:empty={!meta}
                onclick={() => onSlotClick(i)}
                disabled={game.saveMenuMode === 'LOAD' && !meta}
            >
                {#if meta?.screenshot}
                    <img class="slot-thumb" src={meta.screenshot} alt="" />
                {:else}
                    <div class="slot-thumb placeholder"></div>
                {/if}

                <div class="slot-caption">
                    <span class="slot-date">
                        {meta ? formatDate(meta.timestamp) : '—'}
                    </span>
                    {#if meta?.savestamp}
                        <span class="slot-stamp">{meta.savestamp}</span>
                    {/if}
                </div>
            </button>
        {/each}
    </div>

    <footer class="save-footer">
        <button onclick={prevPage} disabled={page === 0}>◀</button>
        <span>Page {page + 1} / {totalPages}</span>
        <button onclick={nextPage} disabled={page >= totalPages - 1}>▶</button>
        <button class="back" onclick={goBack}>Back</button>
    </footer>
</main>