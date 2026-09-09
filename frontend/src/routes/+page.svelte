<script>
  import '../app.css';
  import { onMount } from 'svelte';
  import { env } from '$env/dynamic/public';

  import ErrorMsg from '$lib/components/ErrorMsg.svelte';
  import GameScreen from '$lib/components/GameScreen.svelte';
  import MainMenu from '$lib/components/MainMenu.svelte';

  const PUBLIC_API_URL = env.PUBLIC_API_URL;

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

  // Intercept unhandled global frontend exceptions and check environment variables
  onMount(() => {
    // .env existing check.
    if (!PUBLIC_API_URL) {
      showError(
        'ENV_MISSING_ERROR',
        'The .env file or the PUBLIC_API_URL variable is missing.',
        'Please ensure that the .env file is created in the frontend root folder and contains the variable: PUBLIC_API_URL=http://BACKEND-URL[:PORT]'
      );
    }

    const handleRuntimeError = (event) => {
      event.preventDefault(); 
      
      const error = event.error || event.reason;
      showError(
        'FRONTEND_RUNTIME_ERROR',
        error?.message || 'None',
        error?.stack || 'None'
      );
    };

    // Catch standard JS runtime errors
    window.addEventListener('error', handleRuntimeError);
    // Catch unhandled promise rejections
    window.addEventListener('unhandledrejection', handleRuntimeError);

    return () => {
      window.removeEventListener('error', handleRuntimeError);
      window.removeEventListener('unhandledrejection', handleRuntimeError);
    };
  });

  /**
   * Initiates the game session by requesting a new session token from the backend.
   */
  async function startGame() {
    // Дополнительная проверка перед отправкой запроса, если .env не настроен
    if (!PUBLIC_API_URL) {
      showError(
        'ENV_MISSING_ERROR',
        'Действие заблокировано: файл .env не настроен.',
        'Фронтенд не может определить адрес бэкенда. Создайте файл .env в корне проекта.'
      );
      return;
    }

    const API_URL = `${PUBLIC_API_URL}/api/game/start`;
    try {
      const response = await fetch(API_URL, { method: 'POST' });

      if (!response.ok) {
        let backendErrorMsg = 'None';
        let backendDetails = 'None';

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
        let backendErrorMsg = 'None';
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
  <!-- Fixed: Passed startGame as a normal property function, not a bindable state -->
  <MainMenu
    {startGame}
  />

<!-- ================= SCREEN 2: GAMEPLAY RUNTIME ================= -->
{:else if currentScreen === 'GAME'}
  <!-- Fixed: Removed unnecessary binds for read-only game variables and functions -->
  <GameScreen
    {currentBg}
    {nextStep}
    {currentSpeaker}
    {currentText}
  />

<!-- ================= SCREEN 3: ERROR SYSTEM DIAGNOSTICS ================= -->
{:else if currentScreen === 'ERROR'}
  <!-- Note: Keeping bind:currentScreen since ErrorMsg safely modifies it via $bindable() -->
  <ErrorMsg
    {errorData}
    bind:currentScreen={currentScreen}
  />
{/if}
