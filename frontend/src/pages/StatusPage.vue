<template>
  <main class="p-6">
    <div class="mx-auto max-w-2xl">
      <!-- Loading -->
      <div v-if="!statusData" class="flex items-center justify-center py-20">
        <div class="flex items-center gap-3 text-surface-400">
          <svg class="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
          </svg>
          <span class="text-sm">Loading status...</span>
        </div>
      </div>

      <!-- Status Card -->
      <div v-else class="overflow-hidden rounded-lg border border-surface-200 bg-white dark:border-surface-700 dark:bg-surface-800">
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-surface-100 px-5 py-4 dark:border-surface-700">
          <div class="flex items-center gap-3">
            <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-terminal-500/10">
              <svg v-if="activeSource === 'codex'" class="h-5 w-5 text-terminal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
              </svg>
              <svg v-else-if="activeSource === 'claude'" class="h-5 w-5 text-terminal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
              </svg>
              <svg v-else class="h-5 w-5 text-terminal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
              </svg>
            </div>
            <div>
              <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100">{{ sourceLabel(activeSource) }}</h2>
              <p class="text-xs text-surface-400">Account Status</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
              <span class="h-1.5 w-1.5 rounded-full bg-success"></span>
              Connected
            </span>
          </div>
        </div>

        <!-- Details Grid -->
        <div class="grid gap-px bg-surface-100 dark:bg-surface-700 sm:grid-cols-2">
          <div class="bg-white px-5 py-4 dark:bg-surface-800">
            <p class="text-2xs font-medium uppercase tracking-wider text-surface-400">Model</p>
            <p class="mt-1 font-mono text-sm text-surface-800 dark:text-surface-100">{{ statusData.model || 'Unknown' }}</p>
          </div>
          <div class="bg-white px-5 py-4 dark:bg-surface-800">
            <p class="text-2xs font-medium uppercase tracking-wider text-surface-400">CLI Version</p>
            <p class="mt-1 font-mono text-sm text-surface-800 dark:text-surface-100">{{ statusData.cliVersion || 'Unknown' }}</p>
          </div>
          <div class="bg-white px-5 py-4 dark:bg-surface-800">
            <p class="text-2xs font-medium uppercase tracking-wider text-surface-400">Account</p>
            <p class="mt-1 font-mono text-sm text-surface-800 dark:text-surface-100">{{ statusData.account?.email || 'Not available' }}</p>
          </div>
          <div class="bg-white px-5 py-4 dark:bg-surface-800">
            <p class="text-2xs font-medium uppercase tracking-wider text-surface-400">Tier</p>
            <p class="mt-1 text-sm text-surface-800 dark:text-surface-100">
              <span class="inline-flex items-center rounded-md bg-terminal-500/10 px-2 py-0.5 font-mono text-xs font-medium text-terminal-600 dark:text-terminal-400">
                {{ statusData.account?.tier || 'Unknown' }}
              </span>
            </p>
          </div>
        </div>
      </div>

      <!-- Info Section -->
      <div class="mt-6 rounded-lg border border-surface-200 bg-surface-50 p-4 dark:border-surface-700 dark:bg-surface-800/50">
        <div class="flex gap-3">
          <svg class="mt-0.5 h-4 w-4 shrink-0 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
          </svg>
          <div class="text-xs leading-relaxed text-surface-500 dark:text-surface-400">
            <p>Status information is retrieved from the {{ sourceLabel(activeSource) }} CLI. This includes your current model, account details, and subscription tier.</p>
            <p class="mt-2">Switch sources in the header to view status for different AI assistants.</p>
          </div>
        </div>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useSourceStore } from '../store/source';

type StatusPayload = {
  source?: string;
  model?: string;
  cliVersion?: string;
  account?: { email?: string; tier?: string };
};

const { activeSource } = useSourceStore();
const statusData = ref<StatusPayload | null>(null);

function statusEndpoint(source: string) {
  if (source === 'claude') return '/api/claude/status';
  if (source === 'copilot') return '/api/copilot/status';
  return '/api/status';
}

function sourceLabel(source: string) {
  if (source === 'claude') return 'Claude';
  if (source === 'copilot') return 'Copilot';
  return 'Codex';
}

async function loadStatus() {
  statusData.value = null;
  const response = await fetch(statusEndpoint(activeSource.value));
  statusData.value = await response.json();
}

watch(activeSource, () => {
  loadStatus();
});

onMounted(() => {
  loadStatus();
});
</script>
