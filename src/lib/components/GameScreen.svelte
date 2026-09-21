<script>
    import './GameScreen.css'
    import { useGameContext } from '$lib/__index__.svelte';
    import { onDestroy } from 'svelte';
    import { toCanvas } from 'html-to-image';

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

    /**
     * Renders a save-slot thumbnail at a fixed 1280x720 canvas.
     *
     * The scene is composed from GameState.activeImages and the current
     * dialogue fields, not from a DOM snapshot. This keeps the thumbnail
     * independent of the actual window size: a save made on a 4K desktop
     * and one made on a laptop produce identical thumbnails, which is
     * what the slot grid wants.
     *
     * Images are fitted into the canvas using the same rules as
     * GameScreen.css applies to .dreamrun-dynamic-image. When that rule
     * is object-fit: contain, use 'contain' below; for object-fit: cover,
     * use 'cover'. Keep the two in sync.
     */
    async function captureScreenshot() {
        const W = 1280;
        const H = 720;

        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        ctx.fillStyle = '#050505';
        ctx.fillRect(0, 0, W, H);

        // --- Scenery layers ---
        // Sorted ascending by layer so higher layers draw on top, exactly
        // as GameScreen renders them.
        const layers = [...game.activeImages].sort((a, b) => a.layer - b.layer);

        for (const entry of layers) {
            if (!entry.imgUrl) continue;
            let img;
            try {
                img = await loadImage(entry.imgUrl);
            } catch (e) {
                console.warn('[DreamRun][save] Layer skipped:', entry.id, e);
                continue;
            }

            // Match GameScreen.css: object-fit: contain keeps the whole
            // image visible and centred. Swap to fitCover if the project
            // uses object-fit: cover instead.
            const rect = fitContain(img.naturalWidth, img.naturalHeight, W, H);
            ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
        }

        // --- Dialogue interface ---
        // Sizes mirror GameScreen.css scaled from its native pixel values
        // to a 1280x720 reference frame.
        const interfaceWidth = Math.min(W * 0.8, Math.round(900 * (W / 1280)));
        const interfaceX = (W - interfaceWidth) / 2;
        const interfaceBottomMargin = Math.round(40 * (H / 720));

        const textBoxPadding = Math.round(25 * (H / 720));
        const textBoxMinHeight = Math.round(100 * (H / 720));
        const nameBoxHeight = Math.round(40 * (H / 720));

        // Start with the text box at the bottom, then stack the name
        // plate directly above it.
        const textBoxHeight = textBoxMinHeight;
        const textBoxY = H - interfaceBottomMargin - textBoxHeight;
        const nameBoxY = textBoxY - nameBoxHeight;

        ctx.fillStyle = '#000000';
        ctx.fillRect(interfaceX, textBoxY, interfaceWidth, textBoxHeight);

        // Dialogue body.
        if (game.currentText) {
            ctx.fillStyle = '#ffffff';
            ctx.font = `${Math.round(22 * (H / 720))}px sans-serif`;
            ctx.textBaseline = 'top';
            ctx.textAlign = 'left';

            const maxLineWidth = interfaceWidth - textBoxPadding * 2;
            const lineHeight = Math.round(30 * (H / 720));
            const maxLines = 3;
            const lines = wrapText(ctx, game.currentText, maxLineWidth, maxLines);

            let y = textBoxY + textBoxPadding;
            for (const line of lines) {
                ctx.fillText(line, interfaceX + textBoxPadding, y);
                y += lineHeight;
            }
        }

        // Speaker name plate.
        if (game.currentSpeaker) {
            ctx.font = `bold ${Math.round(20 * (H / 720))}px sans-serif`;
            const labelWidth = ctx.measureText(game.currentSpeaker).width +
                Math.round(35 * (W / 1280)) * 2;

            ctx.fillStyle = '#000000';
            ctx.fillRect(interfaceX, nameBoxY, labelWidth, nameBoxHeight);

            ctx.fillStyle = '#ffffff';
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            ctx.fillText(
                game.currentSpeaker,
                interfaceX + Math.round(35 * (W / 1280)),
                nameBoxY + nameBoxHeight / 2,
            );
        }

        try {
            return canvas.toDataURL('image/webp', 0.4);
        } catch (err) {
            console.error('[DreamRun][save] toDataURL failed:', err);
            return null;
        }
    }

    /**
     * Resolves an <img> element for the given URL, reusing the browser
     * cache. Returns a promise that resolves once the image is decoded.
     */
    function loadImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`Failed to load ${url}`));
            img.src = url;
        });
    }

    /**
     * Fits an image inside boxW x boxH with the same rule as CSS
     * object-fit: contain — scale to fit, preserve aspect, centre.
     */
    function fitContain(imgW, imgH, boxW, boxH) {
        const scale = Math.min(boxW / imgW, boxH / imgH);
        const w = imgW * scale;
        const h = imgH * scale;
        return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
    }

    /**
     * Word-wraps text to fit within maxWidth, stopping after at most
     * maxLines. The final visible line is truncated with an ellipsis when
     * the text does not fit.
     */
    function wrapText(ctx, text, maxWidth, maxLines) {
        const words = String(text).split(/\s+/);
        const lines = [];
        let current = '';

        for (const word of words) {
            const candidate = current ? `${current} ${word}` : word;
            if (ctx.measureText(candidate).width <= maxWidth) {
                current = candidate;
                continue;
            }
            if (current) lines.push(current);
            current = word;
            if (lines.length === maxLines - 1) break;
        }
        if (current && lines.length < maxLines) lines.push(current);

        const consumed = lines.join(' ').length;
        if (consumed < String(text).trim().length) {
            const last = lines[lines.length - 1] ?? '';
            let truncated = last;
            while (truncated.length > 1 &&
                ctx.measureText(truncated + '…').width > maxWidth) {
                truncated = truncated.slice(0, -1);
            }
            lines[lines.length - 1] = truncated + '…';
        }

        return lines;
    }

    /**
     * Opens the SaveMenu on top of the current game.
     *
     * saveMenuReturnTo is set to 'GAME' so that pressing Back in the
     * SaveMenu lands back here rather than on the main menu. When the
     * player actually loads a save, loadGame overrides currentScreen
     * with 'GAME' anyway, so the return value only matters for Back.
     *
     * If a typewriter animation is running when the toolbar is
     * clicked, we finish it first: otherwise, when the component
     * remounts after the save menu closes, the animation would start
     * over from a partial frame.
     */
    async function openSaveMenu(mode) {
        if (isAnimating) finishReveal();

        let screenshotData = null;

        // Execute dynamic rasterization process only when initiating write requests
        if (mode === 'SAVE') {
            screenshotData = await captureScreenshot();
        }

        // Explicitly bind the computed screenshot onto the global state entity
        game.pendingScreenshot = screenshotData;

        game.saveMenuMode = mode;
        game.saveMenuReturnTo = 'GAME';
        game.currentScreen = 'SAVES';
    }

    /**
     * Abandons the current playthrough and returns to the main menu.
     *
     * Equivalent to reaching [game_end]: stops audio, clears the
     * scene, drops the session. No confirmation prompt is shown; the
     * player can always reload from a save slot afterwards.
     */
    function exitToMenu() {
        if (isAnimating) finishReveal();
        game.handleGameEnd();
    }

    $effect(() => {
        // Establish a reactive dependency on the dialogue object itself.
        // Even when the text is identical, a new dialogue object forces
        // the effect to re-run and restart the typewriter.
        const dialogue = game.currentDialogue;

        if (dialogue && dialogue.type === 'choice') {
            finishReveal();
            return;
        }

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
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="interface-toolbar" onclick={(e) => e.stopPropagation()}>
                <button
                    class="toolbar-btn"
                    onclick={() => openSaveMenu('SAVE')}
                    disabled={!game.isGameStarted}
                >Save</button>
                <button
                    class="toolbar-btn"
                    onclick={() => openSaveMenu('LOAD')}
                >Load</button>
                <button
                    class="toolbar-btn"
                    onclick={exitToMenu}
                >Menu</button>
            </div>

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