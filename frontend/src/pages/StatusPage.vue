<template>
  <main class="px-8 pb-8">
    <div v-if="statusData" class="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-slate-900">
      <div class="flex items-center justify-between">
        <div class="text-sm font-semibold">{{ sourceLabel(activeSource) }} Status</div>
        <div class="text-xs text-slate-500 dark:text-slate-400">{{ statusData.cliVersion || 'Version unknown' }}</div>
      </div>
      <div class="mt-4 grid gap-3 md:grid-cols-2">
        <div class="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/70">
          <p class="text-xs uppercase text-slate-500 dark:text-slate-400">Model</p>
          <p class="text-sm">{{ statusData.model || 'Unknown' }}</p>
        </div>
        <div class="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/70">
          <p class="text-xs uppercase text-slate-500 dark:text-slate-400">Account</p>
          <p class="text-sm">{{ statusData.account?.email || '' }}</p>
          <p class="text-xs text-slate-500 dark:text-slate-400">{{ statusData.account?.tier || 'Tier unknown' }}</p>
        </div>
      </div>
    </div>
    <div v-else class="text-sm text-slate-500 dark:text-slate-400">Loading status...</div>
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
