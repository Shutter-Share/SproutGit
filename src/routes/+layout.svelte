<script lang="ts">
  import { onMount } from 'svelte';
  import "../app.css";
  import ToastContainer from "$lib/components/ToastContainer.svelte";

  onMount(() => {
    if (navigator.platform.startsWith('Mac') || /Mac/.test(navigator.userAgent)) {
      document.documentElement.classList.add('platform-macos');
    }
  });
</script>

<slot />
<ToastContainer />
