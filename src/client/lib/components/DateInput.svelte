<script lang="ts">
  let { value = $bindable(''), id = '' }: {
    value: string;
    id?: string;
  } = $props();

  let inputEl: HTMLInputElement;
  let open = $state(false);
</script>

<div class="date-wrap">
  <input
    {id}
    type="date"
    bind:value={value}
    bind:this={inputEl}
    onfocus={() => open = true}
    onblur={() => open = false}
  />
  <button
    type="button"
    class="date-icon-btn"
    aria-label="Kalender öffnen"
    tabindex="-1"
    onmousedown={(e) => {
      e.preventDefault();
      if (open) {
        inputEl.blur();
      } else {
        inputEl.focus();
        inputEl.showPicker();
      }
    }}
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  </button>
</div>

<style>
  .date-wrap {
    position: relative;
    width: 100%;
  }

  .date-wrap :global(input[type="date"]) {
    width: 100%;
    padding-right: 2.2rem;
  }

  /* Hide native calendar icon — we provide our own toggle button */
  .date-wrap :global(input[type="date"]::-webkit-calendar-picker-indicator) {
    display: none !important;
    -webkit-appearance: none;
  }

  .date-icon-btn {
    position: absolute;
    right: 0.5rem;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    padding: 0.25rem;
    cursor: pointer;
    color: var(--text-muted);
    opacity: 0.6;
    transition: opacity 0.15s;
    width: auto;
    height: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    outline: none;
  }

  .date-icon-btn:hover {
    opacity: 1;
  }
</style>
