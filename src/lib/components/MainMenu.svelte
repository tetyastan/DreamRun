<script>
    import './MainMenu.css'
    import { useGameContext } from '$lib/__index__.svelte';
    const game = useGameContext();

    /**
     * Opens the SaveMenu in Load mode, remembering that Back should
     * return here rather than to the in-game screen.
     */
    function openLoadMenu() {
        game.saveMenuMode = 'LOAD';
        game.saveMenuReturnTo = 'MENU';
        game.currentScreen = 'SAVES';
    }
</script>

<main class="container menu-container">
    <div class="menu-screen">
        <h1>DreamRun Template</h1>
        <button onclick={() => game.startGame()} class="menu-btn">Start</button>
        <button onclick={openLoadMenu} class="menu-btn load-trigger">Load</button>
        <button onclick={() => game.currentScreen = 'SETTINGS'} class="menu-btn settings-trigger">Settings</button>
    </div>
</main>