<script>
  import '../app.css';
  import { onMount } from 'svelte';
  import { initGameContext } from '$lib/gameContext.svelte.js';

  import ErrorMsg from '$lib/components/ErrorMsg.svelte';
  import GameScreen from '$lib/components/GameScreen.svelte';
  import MainMenu from '$lib/components/MainMenu.svelte';
  import SettingsMenu from '$lib/components/SettingsMenu.svelte';
  import LoadingScreen from '$lib/components/LoadingScreen.svelte';

  // Initialize state context for all sub-components
  const game = initGameContext();

  // Intercept unhandled global frontend exceptions and check environment variables
  onMount(() => {
    // .env existence verification check
    if (!game.publicApiUrl) {
      game.showError(
        'ENV_MISSING_ERROR',
        'The .env file or the PUBLIC_API_URL variable is missing.',
        'Please ensure that the .env file is created in the frontend root folder and contains the variable: PUBLIC_API_URL=http://BACKEND-URL[:PORT]'
      );
    }

    const handleRuntimeError = (event) => {
      event.preventDefault(); 
      
      const error = event.error || event.reason;
      game.showError(
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
</script>

{#if game.currentScreen === 'MENU'}
    <MainMenu />
{:else if game.currentScreen === 'SETTINGS'}
    <SettingsMenu />
{:else if game.currentScreen === 'GAME'}
    <GameScreen />
{:else if game.currentScreen === 'ERROR'}
    <ErrorMsg />
{/if}

{#if game.isLoading}
    <LoadingScreen />
{/if}
