<script>
    import './GameScreen.css'

    let {
        currentBg,
        nextStep,
        currentSpeaker,
        currentText,
    } = $props();
</script>

<main class="container game-container">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div 
        class="game-screen" 
        style="background-image: url('{currentBg || 'placeholder.jpg'}')"
        onclick={nextStep}
    >
        <div class="interface-container" onclick={(e) => e.stopPropagation()}>
        <!-- Namebox -->
        {#if currentSpeaker}
            <div class="name-box">
            {currentSpeaker}
            </div>
        {/if}

        <!-- Textbox -->
        <div class="text-box" onclick={nextStep}>
            <p>{currentText}</p>
            <span class="click-hint">▼</span>
        </div>
        </div>
    </div>
</main>