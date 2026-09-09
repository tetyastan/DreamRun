<script>
    import './GameScreen.css'
    import { useGameContext } from '$lib/gameContext.svelte';
    const game = useGameContext();

    let displayedText = $state('');
    let currentIndex = 0;
    let intervalId = null;
    let isAnimating = $state(false);

    function startTextAnimation(text) {
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }

        displayedText = '';
        currentIndex = 0;

        if (!text) {
            isAnimating = false;
            return;
        }

        // If the slider is at the maximum right position (11), skip animation completely
        if (game.textSpeed === 11) {
            displayedText = text;
            currentIndex = text.length;
            isAnimating = false;
            return;
        }

        isAnimating = true;

        // Convert speed steps (1 to 10) into invert milliseconds delays.
        const calculatedDelay = (11 - game.textSpeed) * 10;

        intervalId = setInterval(() => {
            if (currentIndex < text.length) {
                displayedText += text[currentIndex];
                currentIndex++;
            } else {
                clearAnimation();
            }
        }, calculatedDelay);
    }

    function clearAnimation() {
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }
        isAnimating = false;
    }

    function finishAnimation() {
        clearAnimation();
        // Access currentText from the game context
        displayedText = game.currentText;
        currentIndex = game.currentText.length;
    }

    function handleScreenClick(e) {
        // Prevent action if the user is highlighting text
        const selection = window.getSelection();
        if (selection && selection.toString().length > 0) {
            return;
        }

        // Stop the click from traveling down or up unexpectedly
        e.stopPropagation();

        if (isAnimating) {
            finishAnimation();
        } else {
            // Trigger nextStep from the game context
            game.nextStep();
        }
    }

    $effect(() => {
        // Watch currentText from the game context
        startTextAnimation(game.currentText);
    });
</script>

<main class="container game-container">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div 
        class="game-screen" 
        style="background-image: url('{game.currentBg || 'placeholder.jpg'}')"
        onclick={handleScreenClick}
    >
        <!-- The interface container intercepts clicks to handle layout isolation safely -->
        <div class="interface-container" onclick={(e) => e.stopPropagation()}>
            <!-- Namebox -->
            {#if game.currentSpeaker}
                <div class="name-box">
                    {game.currentSpeaker}
                </div>
            {/if}

            <!-- Textbox -->
            <div class="text-box" onclick={handleScreenClick}>
                <p>{displayedText}</p>
                
                {#if !isAnimating}
                    <span class="click-hint">▼</span>
                {/if}
            </div>
        </div>
    </div>
</main>
