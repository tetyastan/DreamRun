<script>
    import './ErrorMsg.css';
    import { useGameContext } from '$lib/__index__.svelte';
    const game = useGameContext();

    function copyToClipboard() {
        const text = [
            `Status: ${game.errorData.status}`,
            `Msg: ${game.errorData.message}`,
            `Details: ${game.errorData.details}`,
        ].join('\n');
        navigator.clipboard?.writeText(text).catch(() => {});
    }
</script>

<main class="container error-container">
    <div class="error-card">
        <div class="error-header">
            <h1>Engine error</h1>
        </div>

        <div class="error-body">
            <div class="info-row">
                <span class="label">Status:</span>
                <span class="status-code">{game.errorData.status}</span>
            </div>

            <div class="info-row">
                <span class="label">Msg:</span>
                <span class="highlight">{game.errorData.message}</span>
            </div>

            <div class="details-box">
                <span class="label">Stack / Details:</span>
                <pre>{game.errorData.details}</pre>
            </div>
        </div>

        <div class="error-footer">
            <button onclick={() => game.currentScreen = 'MENU'} class="retry-btn">Main Menu</button>
            <button onclick={copyToClipboard} class="retry-btn">Copy</button>
        </div>
    </div>
</main>