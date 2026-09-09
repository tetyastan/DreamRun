<script>
    import './MainMenu.css'
    import { useGameContext } from '$lib/gameContext.svelte';
    const game = useGameContext();
</script>

<main class="container menu-container">
    <div class="menu-screen">
        <h1>DreamRun Template</h1>
        <button onclick={() => game.startGame()} class="menu-btn">Start</button>
        <button onclick={() => game.currentScreen = 'SETTINGS'} class="menu-btn settings-trigger">Settings</button>
    </div>
</main>