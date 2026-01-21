<template>
  <main class="p-6">
    <div class="mx-auto max-w-4xl">
      <!-- Header -->
      <div class="mb-6 flex items-center justify-between">
        <div>
          <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100">Session Feedback</h2>
          <p class="mt-0.5 text-sm text-surface-500">Collected feedback and observations from your sessions</p>
        </div>
        <span class="font-mono text-sm text-surface-400">{{ feedbackEntries.length }} entries</span>
      </div>

      <!-- Empty State -->
      <div v-if="feedbackEntries.length === 0" class="flex flex-col items-center justify-center rounded-lg border border-dashed border-surface-200 py-16 dark:border-surface-700">
        <svg class="h-10 w-10 text-surface-300 dark:text-surface-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
        </svg>
        <p class="mt-3 text-sm text-surface-500">No feedback collected yet</p>
        <p class="mt-1 font-mono text-xs text-surface-400">Run npm run feedback:log to add entries</p>
      </div>

      <template v-else>
        <!-- Tags Overview -->
        <div v-if="feedbackTagSummary.length" class="mb-6 rounded-lg border border-surface-200 bg-white p-4 dark:border-surface-700 dark:bg-surface-800">
          <div class="mb-3 text-2xs font-medium uppercase tracking-wider text-surface-400">Observation Tags</div>
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="tag in feedbackTagSummary"
              :key="tag.name"
              class="inline-flex items-center gap-1 rounded-md bg-terminal-500/10 px-2 py-1 font-mono text-2xs text-terminal-600 dark:text-terminal-400"
            >
              {{ tag.name }}
              <span class="text-terminal-500/60">{{ tag.count }}</span>
            </span>
          </div>
        </div>

        <!-- Feedback List -->
        <div class="space-y-4">
          <article
            v-for="entry in feedbackEntries"
            :key="entry.createdAt + entry.relPath"
            class="rounded-lg border border-surface-200 bg-white dark:border-surface-700 dark:bg-surface-800"
          >
            <!-- Entry Header -->
            <div class="flex items-start justify-between gap-4 border-b border-surface-100 px-4 py-3 dark:border-surface-700">
              <div class="min-w-0 flex-1">
                <div class="truncate font-mono text-sm font-medium text-surface-800 dark:text-surface-100" :title="entry.relPath">
                  {{ shortenPath(entry.relPath) }}
                </div>
                <div class="mt-0.5 font-mono text-2xs text-surface-400">{{ formatTimestamp(entry.createdAt) }}</div>
              </div>
              <span
                class="shrink-0 rounded-md px-2 py-1 font-mono text-2xs font-medium"
                :class="labelClass(entry.label)"
              >
                {{ entry.label }}
              </span>
            </div>

            <!-- Went Well / Needs Improvement -->
            <div class="grid gap-px bg-surface-100 dark:bg-surface-700 md:grid-cols-2">
              <div class="bg-white px-4 py-3 dark:bg-surface-800">
                <div class="mb-2 flex items-center gap-1.5">
                  <svg class="h-3.5 w-3.5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path d="M5 13l4 4L19 7"/>
                  </svg>
                  <span class="text-2xs font-medium uppercase tracking-wider text-surface-400">Went well</span>
                </div>
                <ul v-if="entry.wentWell?.length" class="space-y-1">
                  <li v-for="item in entry.wentWell" :key="item" class="text-xs text-surface-600 dark:text-surface-300">
                    {{ item }}
                  </li>
                </ul>
                <p v-else class="text-xs italic text-surface-400">None noted</p>
              </div>

              <div class="bg-white px-4 py-3 dark:bg-surface-800">
                <div class="mb-2 flex items-center gap-1.5">
                  <svg class="h-3.5 w-3.5 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                  </svg>
                  <span class="text-2xs font-medium uppercase tracking-wider text-surface-400">Needs improvement</span>
                </div>
                <ul v-if="entry.needsImprovement?.length" class="space-y-1">
                  <li v-for="item in entry.needsImprovement" :key="item" class="text-xs text-surface-600 dark:text-surface-300">
                    {{ item }}
                  </li>
                </ul>
                <p v-else class="text-xs italic text-surface-400">None noted</p>
              </div>
            </div>

            <!-- Observations -->
            <div v-if="entry.observations?.length" class="border-t border-surface-100 p-4 dark:border-surface-700">
              <div class="mb-3 text-2xs font-medium uppercase tracking-wider text-surface-400">Observations</div>
              <div class="space-y-3">
                <div
                  v-for="obs in entry.observations"
                  :key="obs.id + obs.snippet"
                  class="rounded-md bg-surface-50 p-3 dark:bg-surface-900"
                >
                  <div class="text-sm font-medium text-surface-800 dark:text-surface-100">{{ obs.title }}</div>
                  <p v-if="obs.rationale" class="mt-1 text-xs text-surface-500 dark:text-surface-400">{{ obs.rationale }}</p>
                  <pre v-if="obs.snippet" class="mt-2 overflow-x-auto rounded bg-surface-900 p-2 font-mono text-2xs text-surface-100">{{ obs.snippet }}</pre>
                  <div v-if="obs.tags?.length" class="mt-2 flex flex-wrap gap-1">
                    <span
                      v-for="tag in obs.tags"
                      :key="tag"
                      class="rounded bg-surface-200 px-1.5 py-0.5 font-mono text-2xs text-surface-500 dark:bg-surface-700 dark:text-surface-400"
                    >
                      {{ tag }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </article>
        </div>
      </template>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

const feedbackEntries = ref<any[]>([]);

const feedbackTagSummary = computed(() => {
  const tags: Record<string, number> = {};
  feedbackEntries.value.forEach((entry) => {
    (entry.observations || []).forEach((obs: any) => {
      (obs.tags || []).forEach((tag: string) => {
        tags[tag] = (tags[tag] || 0) + 1;
      });
    });
  });
  return Object.entries(tags)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
});

function formatTimestamp(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function shortenPath(path: string) {
  if (!path) return '';
  const parts = path.split('/');
  if (parts.length <= 3) return path;
  return '.../' + parts.slice(-2).join('/');
}

function labelClass(label: string) {
  if (label === 'positive') return 'bg-success/10 text-success';
  if (label === 'negative') return 'bg-error/10 text-error';
  return 'bg-warning/10 text-warning';
}

async function loadFeedback() {
  const response = await fetch('/api/feedback-log');
  const data = await response.json();
  feedbackEntries.value = data.entries || [];
}

onMounted(() => {
  loadFeedback();
});
</script>
