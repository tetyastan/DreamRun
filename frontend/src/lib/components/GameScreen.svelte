<script>
    import './GameScreen.css'
    import { useGameContext } from '$lib/__index__.svelte';
    import { onDestroy } from 'svelte';

    const game = useGameContext();

    let displayedText = $state('');
    let currentIndex = 0;
    let intervalId = null;
    let isAnimating = $state(false);
    // Sort overlay nodes strictly matching backend execution layer configuration integers
    let sortedImages = $derived([...game.activeImages].sort((a, b) => a.layer - b.layer));

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

    function finalizeHideSequence(id) {
        // Physical absolute purge from DOM tree array memory slots
        game.activeImages = game.activeImages.filter(img => img.id !== id);
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

    $effect(() => {
        // Establish a reactive dependency on the dialogue object itself.
        // Even when the text is identical, a new dialogue object forces
        // the effect to re-run and restart the typewriter.
        game.currentDialogue;
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
        onclick={handleScreenClick}
    >
        <div class="scenery-canvas-viewport">
            {#each sortedImages as img (img.id)}
                {#if img.containerBlob}
                    <link rel="stylesheet" href={img.containerBlob}>
                {/if}
                {#if img.imageBlob}
                    <link rel="stylesheet" href={img.imageBlob}>
                {/if}

                <!-- The container and internal graphic leaf now wear classes driven by their filenames -->
                <div 
                    class={img.containerClass}
                    data-node-id={img.id}
                    class:dr-hide-active={img.isHiding}
                    onanimationend={() => { if (img.isHiding) finalizeHideSequence(img.id); }}
                    ontransitionend={() => { if (img.isHiding) finalizeHideSequence(img.id); }}
                >
                    <img 
                        src={img.imgUrl} 
                        alt={img.id}
                        class={img.imageClass}
                    />
                </div>
            {/each}
        </div>

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