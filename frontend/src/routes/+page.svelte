<script>
  import '../app.css';
  import { PUBLIC_API_URL } from '$env/static/public';

  // SPA game screens: 'MENU', 'GAME', 'ERROR'
  let currentScreen = $state('MENU');

  // Global state of the current visual novel session
  let sessionId = $state('');
  let steps = $state([]);
  let hasNext = $state(false);
  
  // Internal state of steps within the active act
  let currentStepIndex = $state(0);
  let currentBg = $state('');
  let currentSpeaker = $state(null);
  let currentText = $state('');

  // Local reactive variables for the error interface
  let errorData = $state({ status: 'None', message: 'None', details: 'None' });

  /**
   * Displays the custom error screen with technical details.
   */
  function showError(status, message, details) {
    errorData = { status, message, details };
    currentScreen = 'ERROR';
  }

  /**
   * Initiates the game session by requesting a new session token from the backend.
   */
  async function startGame() {
    const API_URL = `${PUBLIC_API_URL}/api/game/start`;
    try {
      const response = await fetch(API_URL, { method: 'POST' });

      if (!response.ok) {
        let backendErrorMsg = 'Unknown Backend Error';
        let backendDetails = '';

        try {
          const errorJson = await response.json();
          backendErrorMsg = errorJson.detail || JSON.stringify(errorJson);
          backendDetails = `FastAPI Endpoint: ${API_URL}\nResponse Status: ${response.status}`;
        } catch {
          backendErrorMsg = await response.text();
        }
        
        showError(
          response.status.toString(), 
          `Backend error: ${response.statusText}`, 
          `${backendErrorMsg}\n\n${backendDetails}`
        );
        return;
      }

      const data = await response.json();
      
      // Save new session data
      sessionId = data.session_id;
      steps = data.steps;
      hasNext = data.has_next;
      
      // Reset markers and pivot screen to active gameplay
      currentStepIndex = 0;
      currentScreen = 'GAME';
      processStep();

    } catch (err) {
      showError(
        'FETCH_ERROR', 
        'Backend connection error.', 
        `${err?.message || err}\n${err?.stack || ''}`
      );
    }
  }

  /**
   * Evaluates and updates the visual novel interface elements based on the current step.
   */
  function processStep() {
    if (currentStepIndex >= steps.length) {
      handleActEnd();
      return;
    }

    const step = steps[currentStepIndex];

    if (step.type === 'bg') {
      currentBg = step.value;
      currentStepIndex++;
      processStep(); // Automatically proceed to the subsequent line of dialogue after updating background
    } else if (step.type === 'dialogue') {
      currentSpeaker = step.name;
      currentText = step.text;
    }
  }

  function nextStep() {
    currentStepIndex++;
    processStep();
  }

  /**
   * Requests the upcoming act using a secure POST request loaded with the current Session-ID.
   */
  async function handleActEnd() {
    if (!hasNext) {
      // Scenario complete — redirect user gracefully back to the main menu
      currentScreen = 'MENU';
      return;
    }

    try {
      const response = await fetch(`${PUBLIC_API_URL}/api/game/next`, {
        method: 'POST',
        headers: {
          'X-Session-ID': sessionId
        }
      });

      if (!response.ok) {
        let backendErrorMsg = 'Unknown Backend Error';
        try {
          const errorJson = await response.json();
          backendErrorMsg = errorJson.detail || JSON.stringify(errorJson);
        } catch {
          backendErrorMsg = await response.text();
        }
        throw new Error(backendErrorMsg);
      }

      const resData = await response.json();
      
      // Update state data hooks for the incoming act inside the SPA pipeline
      steps = resData.steps;
      hasNext = resData.has_next;
      currentStepIndex = 0;
      processStep();

    } catch (err) {
      showError(
        'GAME_FETCH_ERROR', 
        'Failed to load the next chapter.', 
        err?.message || String(err)
      );
    }
  }
</script>

<!-- ================= SCREEN 1: MAIN MENU ================= -->
{#if currentScreen === 'MENU'}
  <main class="container menu-container">
    <div class="menu-screen">
      <h1>DreamRun Template</h1>
      <button onclick={startGame} class="menu-btn">Start</button>
    </div>
  </main>

<!-- ================= SCREEN 2: GAMEPLAY RUNTIME ================= -->
{:else if currentScreen === 'GAME'}
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

<!-- ================= SCREEN 3: ERROR SYSTEM DIAGNOSTICS ================= -->
{:else if currentScreen === 'ERROR'}
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
{/if}