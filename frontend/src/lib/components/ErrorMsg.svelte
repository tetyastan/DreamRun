<script>
    import './ErrorMsg.css'

    let {
        errorData,
        currentScreen = $bindable(),
    } = $props();
</script>

<main class="container error-container">
    <div class="error-card">
        <div class="error-header">
        <h1>Engine error</h1>
        </div>

        <div class="error-body">
        <div class="info-row">
            <span class="label">Status:</span>
            <span class="status-code">{errorData.status}</span>
        </div>

        <div class="info-row">
            <span class="label">Msg:</span>
            <span class="highlight">{errorData.message}</span>
        </div>

        <div class="details-box">
            <span class="label">Stack / Details:</span>
            <pre>{errorData.details}</pre>
        </div>
        </div>

        <div class="error-footer">
        <button onclick={() => currentScreen = 'MENU'} class="retry-btn">Main Menu</button>
        </div>
    </div>
</main>