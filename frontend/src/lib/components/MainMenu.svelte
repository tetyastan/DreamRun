<script>
    import './MainMenu.css'

    let {
        startGame,
    } = $props();
</script>

<main class="container menu-container">
    <div class="menu-screen">
        <h1>DreamRun Template</h1>
        <button onclick={startGame} class="menu-btn">Start</button>
    </div>
</main>