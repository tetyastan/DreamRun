<script>
    import './GameScreen.css'

    let {
        currentBg,
        nextStep,
        currentSpeaker,
        currentText,
    } = $props();

    let displayedText = $state('');
    let currentIndex = 0;
    let intervalId = null;

    const TEXT_SPEED = 30; 

    function startTextAnimation(text) {
        // Clear the previous timer if there was one.
        if (intervalId) clearInterval(intervalId);
        
        displayedText = '';
        currentIndex = 0;

        if (!text) return;

        intervalId = setInterval(() => {
            if (currentIndex < text.length) {
                displayedText += text[currentIndex];
                currentIndex++;
            } else {
                clearInterval(intervalId);
                intervalId = null;
            }
        }, TEXT_SPEED);
    }

    $effect(() => {
        startTextAnimation(currentText);
    });

    // Checking whether the player attempted to skip the dialogue or select the text.
    function handleTextClick(e) {
        // Получаем объект текущего выделения в браузере
        const selection = window.getSelection();
        
        // If the selected text is not empty, it means the user is selecting a string.
        // Abort the function and do NOT call nextStep.
        if (selection && selection.toString().length > 0) {
            return;
        }

        // Если выделения нет — это обычный клик, переходим к следующему шагу
        nextStep();
    }
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
        <div class="text-box" onclick={handleTextClick}>
            <!-- Выводим локальную переменную displayedText вместо исходного currentText -->
            <p>{displayedText}</p>
            
            <!-- Стрелочку-подсказку показываем только тогда, когда текст дописан до конца -->
            {#if !intervalId}
                <span class="click-hint">▼</span>
            {/if}
        </div>
        </div>
    </div>
</main>