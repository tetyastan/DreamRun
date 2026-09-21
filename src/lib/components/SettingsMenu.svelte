<script>
    import './SettingsMenu.css';
    import { useGameContext } from '$lib/__index__.svelte';
    const game = useGameContext();
</script>

<main class="container settings-container">
    <div class="settings-card">
        <div class="settings-header">
            <h1>Game Settings</h1>
        </div>

        <div class="settings-body">
            <div class="setting-row">
                <label for="speed-range" class="label">Text Speed:</label>
                <div class="slider-container">
                    <input
                        id="speed-range"
                        type="range"
                        min="1"
                        max="11"
                        step="0.5"
                        bind:value={game.textSpeed}
                    />
                    <span class="speed-value">
                        {#if game.textSpeed === 11}
                            Instant
                        {:else}
                            Speed {game.textSpeed}
                        {/if}
                    </span>
                </div>
            </div>

            <div class="setting-row">
                <label for="volume-range" class="label">Master Volume:</label>
                <div class="slider-container">
                    <input
                        id="volume-range"
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        bind:value={game.masterVolume}
                    />
                    <span class="speed-value">
                        {Math.round(game.masterVolume * 100)}%
                    </span>
                </div>
            </div>
        </div>

        <div class="settings-footer">
            <button onclick={() => game.currentScreen = 'MENU'} class="back-btn">Back</button>
        </div>
    </div>
</main>