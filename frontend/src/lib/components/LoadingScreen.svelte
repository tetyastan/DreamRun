<script>
    import './LoadingScreen.css';
    import { useGameContext } from '$lib/gameContext.svelte';
    const gameState = useGameContext();
</script>

<!-- Smooth loader state handling: renders the view context layer only when debounced network timers trigger visibility flags -->
{#if gameState.showLoadingUI}
    <div class="loading-overlay">
        <div class="loading-content">
            <span class="loading-text">Loading...</span>
            <div class="loading-spinner"></div>
        </div>
    </div>
{/if}
