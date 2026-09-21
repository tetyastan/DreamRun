<script>
  import '../app.css';
  import { onMount } from 'svelte';
  import { initGameContext } from '$lib/__index__.svelte';

  import ErrorMsg from '$lib/components/ErrorMsg.svelte';
  import GameScreen from '$lib/components/GameScreen.svelte';
  import MainMenu from '$lib/components/MainMenu.svelte';
  import SettingsMenu from '$lib/components/SettingsMenu.svelte';
  import SaveMenu from '$lib/components/SaveMenu.svelte';
  import LoadingScreen from '$lib/components/LoadingScreen.svelte';

  // Initialize state context for all sub-components
  const game = initGameContext();

  // Intercept unhandled global frontend exceptions and check environment variables
  onMount(() => {
    const handleRuntimeError = (event) => {
      event.preventDefault();
      const error = event.error || event.reason;
      game.showError(
        'FRONTEND_RUNTIME_ERROR',
        error?.message || 'None',
        error?.stack || 'None'
      );
    };

    window.addEventListener('error', handleRuntimeError);
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
{:else if game.currentScreen === 'SAVES'}
    <SaveMenu />
{/if}

{#if game.isLoading}
    <LoadingScreen />
{/if}
