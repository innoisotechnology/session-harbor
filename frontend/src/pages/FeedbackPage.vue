<template>
  <main class="px-8 pb-8">
    <div class="space-y-4">
      <div class="flex flex-wrap gap-2">
        <span
          v-for="tag in feedbackTagSummary"
          :key="tag.name"
          class="rounded-full bg-blue-100 px-3 py-1 text-xs dark:bg-blue-900/40 dark:text-blue-100"
        >
          {{ tag.name }} ({{ tag.count }})
        </span>
      </div>
      <article
        v-for="entry in feedbackEntries"
        :key="entry.createdAt + entry.relPath"
        class="rounded-2xl border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm font-semibold">{{ entry.relPath }}</div>
            <div class="text-xs text-slate-500 dark:text-slate-400">{{ formatTimestamp(entry.createdAt) }}</div>
          </div>
          <span class="rounded-full px-3 py-1 text-xs" :class="labelClass(entry.label)">
            {{ entry.label }}
          </span>
        </div>
        <div class="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <p class="text-xs uppercase text-slate-500 dark:text-slate-400">Went well</p>
            <ul class="mt-1 space-y-1 text-sm text-slate-700 dark:text-slate-300">
              <li v-for="item in entry.wentWell" :key="item">• {{ item }}</li>
            </ul>
          </div>
          <div>
            <p class="text-xs uppercase text-slate-500 dark:text-slate-400">Needs improvement</p>
            <ul class="mt-1 space-y-1 text-sm text-slate-700 dark:text-slate-300">
              <li v-for="item in entry.needsImprovement" :key="item">• {{ item }}</li>
            </ul>
          </div>
        </div>
        <div v-if="entry.observations?.length" class="mt-3 space-y-2">
          <div
            v-for="obs in entry.observations"
            :key="obs.id + obs.snippet"
            class="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/70"
          >
            <div class="text-sm font-semibold">{{ obs.title }}</div>
            <p class="mt-1 text-xs text-slate-600 dark:text-slate-300">{{ obs.rationale }}</p>
            <pre class="mt-2 rounded-lg bg-slate-900/90 p-3 text-xs text-slate-100">{{ obs.snippet }}</pre>
          </div>
        </div>
      </article>
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
  if (!value) return 'Unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function labelClass(label: string) {
  if (label === 'positive') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200';
  if (label === 'negative') return 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200';
  return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200';
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
