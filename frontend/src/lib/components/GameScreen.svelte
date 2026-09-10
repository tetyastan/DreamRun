<script>
    import './GameScreen.css'
    import { useGameContext } from '$lib/gameContext.svelte';
    import { onDestroy } from 'svelte';

    const game = useGameContext();

    let displayedText = $state('');
    let currentIndex = 0;
    let intervalId = null;
    let isAnimating = $state(false);

    function clearAnimation() {
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }
        isAnimating = false;
    }

    function startRevealAnimation(text) {
        clearAnimation();
        displayedText = '';
        currentIndex = 0;

        if (!text) return;

        if (game.textSpeed === 11) {
            displayedText = text;
            currentIndex = text.length;
            return;
        }

        isAnimating = true;
        const delay = (11 - game.textSpeed) * 10;

        intervalId = setInterval(() => {
            if (currentIndex < text.length) {
                displayedText += text[currentIndex];
                currentIndex++;
            } else {
                clearAnimation();
            }
        }, delay);
    }

    function finishReveal() {
        clearAnimation();
        displayedText = game.currentText;
        currentIndex = game.currentText.length;
    }

    function handleScreenClick(e) {
        const selection = window.getSelection();
        if (selection && selection.toString().length > 0) return;

        e.stopPropagation();

        if (isAnimating) {
            finishReveal(); // Instantly skips typewriter animation frame perfectly on click
        } else if (game.pendingNextStep) {
            game.handleClick();
        } else {
            game.nextStep();
        }
    }

    // Reactive reaction layer tracking plain text changes directly
    $effect(() => {
        startRevealAnimation(game.currentText);
    });

    onDestroy(() => {
        clearAnimation();
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
        {#if game.currentBg && game.currentBg.startsWith('MISSING:')}
            <div class="missing-bg-placeholder" onclick={(e) => e.stopPropagation()}>
                <p class="error-title">Missing Background Asset</p>
                <p class="file-name">{game.currentBg.replace('MISSING:', '')}</p>
                <p class="tip-text">
                    Please place file under your /assets/ folder on backend server.
                </p>
            </div>
        {/if}

        <div class="interface-container" onclick={(e) => e.stopPropagation()}>
            {#if game.currentSpeaker}
                <div class="name-box">
                    {game.currentSpeaker}
                </div>
            {/if}

            <div class="text-box" onclick={handleScreenClick}>
                <p>{displayedText}</p>

                {#if !isAnimating && game.pendingNextStep}
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