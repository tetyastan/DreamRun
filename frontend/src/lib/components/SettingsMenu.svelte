<!-- src/lib/components/SettingsMenu.svelte -->
<script>
    import './SettingsMenu.css';
    import { useGameContext } from '$lib/gameContext.svelte';
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
                    <!-- 
                      min=1 (Slowest animation)
                      max=11 (Instant text display without animation)
                    -->
                    <input 
                        id="speed-range"
                        type="range" 
                        min="1" 
                        max="11" 
                        step="1"
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
        </div>

        <div class="settings-footer">
            <button onclick={() => game.currentScreen = 'MENU'} class="back-btn">Back</button>
        </div>
    </div>
</main>
