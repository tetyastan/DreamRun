<script>
    import './GameScreen.css'
    import { useGameContext } from '$lib/gameContext.svelte';
    import { onDestroy } from 'svelte';
    const game = useGameContext();

    let displayedText = $state('');
    let currentIndex = 0;
    let intervalId = null;
    let isAnimating = $state(false);

    function startTextAnimation(text) {
        // Clear any existing animation
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }

        // Reset display state
        displayedText = '';
        currentIndex = 0;
        isAnimating = false;

        // If no text, just return
        if (!text) {
            return;
        }

        // If the slider is at the maximum right position (11), skip animation completely
        if (game.textSpeed === 11) {
            displayedText = text;
            currentIndex = text.length;
            isAnimating = false;
            return;
        }

        // Start the animation
        isAnimating = true;

        // Convert speed steps (1 to 10) into milliseconds delays.
        // Speed 1 = 100ms per character, Speed 10 = 10ms per character
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
            // If animation is playing, finish it immediately
            finishAnimation();
        } else if (game.pendingNextStep) {
            // Advance game state safely using centralized context call
            game.handleClick();
        } else {
            // Fallback strategy to push stream
            game.nextStep();
        }
    }

    // Svelte 5 native reactive tracking directly on currentText
    $effect(() => {
        startTextAnimation(game.currentText);
    });

    // Clean up interval on component destroy
    onDestroy(() => {
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }
    });
</script>

<main class="container game-container">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
        class="game-screen"
        style={game.currentBg && !game.currentBg.startsWith('MISSING:') ? `background-image: url('${game.currentBg}')` : ''}
		onclick={handleScreenClick}
		>
		
		<!-- Render a clear debug watermark overlay if the background asset file is missing on the server -->
		{#if game.currentBg && game.currentBg.startsWith('MISSING:')}
		    <div class="missing-bg-placeholder" onclick={(e) => e.stopPropagation()}>
			    <p class="error-title">Missing Background Asset</p>
			    <p class="file-name">{game.currentBg.replace('MISSING:', '')}
			    <p class="tip-text">
				    Please place file under your /assets/backgrounds/ folder on backend server.
			    </p>
		    </div>
		{/if}
		
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
                
                <!-- Only show click hint if animation is complete AND there's dialogue to advance -->
                {#if !isAnimating && game.currentText && game.pendingNextStep}
                    <span class="click-hint">▼</span>
                {/if}
            </div>

            {#if game.currentChoices && game.currentChoices.length > 0}
                <div class="choices-overlay" onclick={(e) => e.stopPropagation()}>
                    <div class="choices-container">
                        {#each game.currentChoices as choice}
                            <button 
                                onclick={() => game.selectChoice(choice.index)} 
                                class="choice-btn"
                                disabled={game.isLoading}
                            >
                                {choice.text}
                            </button>
                        {/each}
                    </div>
                </div>
            {/if}
        </div>
    </div>
</main>
