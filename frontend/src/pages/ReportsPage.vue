<template>
  <main class="flex h-[calc(100vh-88px)] gap-px bg-surface-200 dark:bg-surface-800">
    <!-- Left Panel: Reports List -->
    <section class="flex w-72 flex-col bg-surface-50 dark:bg-surface-900">
      <div class="flex items-center justify-between border-b border-surface-100 px-4 py-3 dark:border-surface-800">
        <span class="text-2xs font-medium uppercase tracking-wider text-surface-400">Reports</span>
        <span class="font-mono text-2xs text-surface-400">{{ reports.length }}</span>
      </div>

      <div class="flex-1 overflow-y-auto scrollbar-thin p-2">
        <div v-if="reports.length === 0" class="flex flex-col items-center justify-center py-12 text-center">
          <svg class="h-8 w-8 text-surface-300 dark:text-surface-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
          <p class="mt-2 text-xs text-surface-400">No reports yet</p>
          <p class="mt-1 font-mono text-2xs text-surface-400">Run npm run review:sessions</p>
        </div>

        <div class="space-y-1">
          <button
            v-for="report in reports"
            :key="report.name"
            class="w-full rounded-md p-2.5 text-left transition-colors"
            :class="activeReport?.name === report.name
              ? 'bg-terminal-500/10 ring-1 ring-terminal-500/30'
              : 'hover:bg-surface-100 dark:hover:bg-surface-800'"
            @click="selectReport(report)"
          >
            <div class="font-mono text-xs font-medium text-surface-800 dark:text-surface-100">{{ report.name }}</div>
            <div class="mt-1 font-mono text-2xs text-surface-400">{{ formatTimestamp(report.createdAt) }}</div>
          </button>
        </div>
      </div>
    </section>

    <!-- Right Panel: Report Content -->
    <section class="flex flex-1 flex-col bg-surface-50 dark:bg-surface-900">
      <!-- Empty State -->
      <div v-if="!activeReport" class="flex flex-1 flex-col items-center justify-center text-surface-400">
        <svg class="h-12 w-12 text-surface-200 dark:text-surface-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
          <path d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
        </svg>
        <p class="mt-3 text-sm">Select a report to view</p>
      </div>

      <!-- Report Content -->
      <template v-else>
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-surface-200 px-4 py-3 dark:border-surface-800">
          <div>
            <h2 class="font-mono text-base font-semibold text-surface-900 dark:text-surface-100">{{ activeReport.name }}</h2>
            <p class="mt-0.5 font-mono text-xs text-surface-400">{{ formatTimestamp(activeReport.createdAt) }}</p>
          </div>
        </div>

        <!-- Content -->
        <div class="flex-1 overflow-y-auto scrollbar-thin p-4">
          <!-- Summary -->
          <div v-if="reportSummary" class="mb-6">
            <div class="mb-2 text-2xs font-medium uppercase tracking-wider text-surface-400">Summary</div>
            <pre class="overflow-x-auto rounded-lg bg-surface-900 p-4 font-mono text-xs leading-relaxed text-surface-100">{{ reportSummary }}</pre>
          </div>

          <!-- Tags Summary -->
          <div v-if="sortedTagSummary.length" class="mb-6">
            <div class="mb-2 text-2xs font-medium uppercase tracking-wider text-surface-400">Tags</div>
            <div class="flex flex-wrap gap-1.5">
              <span
                v-for="tag in sortedTagSummary"
                :key="tag.name"
                class="inline-flex items-center gap-1 rounded-md bg-terminal-500/10 px-2 py-1 font-mono text-2xs text-terminal-600 dark:text-terminal-400"
              >
                {{ tag.name }}
                <span class="text-terminal-500/60">{{ tag.count }}</span>
              </span>
            </div>
          </div>

          <!-- Observations -->
          <div v-if="reportRecommendations?.observations?.length">
            <div class="mb-3 text-2xs font-medium uppercase tracking-wider text-surface-400">
              Observations ({{ reportRecommendations.observations.length }})
            </div>
            <div class="space-y-3">
              <article
                v-for="obs in reportRecommendations.observations"
                :key="obs.id + obs.snippet"
                class="rounded-lg border border-surface-200 bg-white p-4 dark:border-surface-700 dark:bg-surface-800"
              >
                <div class="flex items-start justify-between gap-3">
                  <h3 class="text-sm font-medium text-surface-800 dark:text-surface-100">{{ obs.title }}</h3>
                  <span v-if="obs.session" class="shrink-0 font-mono text-2xs text-surface-400">{{ shortenSession(obs.session) }}</span>
                </div>
                <p v-if="obs.rationale" class="mt-2 text-xs leading-relaxed text-surface-500 dark:text-surface-400">{{ obs.rationale }}</p>
                <pre v-if="obs.snippet" class="mt-3 overflow-x-auto rounded-md bg-surface-900 p-3 font-mono text-2xs leading-relaxed text-surface-100">{{ obs.snippet }}</pre>
                <div v-if="obs.tags?.length" class="mt-3 flex flex-wrap gap-1">
                  <span
                    v-for="tag in obs.tags"
                    :key="tag"
                    class="rounded bg-surface-100 px-1.5 py-0.5 font-mono text-2xs text-surface-500 dark:bg-surface-700 dark:text-surface-400"
                  >
                    {{ tag }}
                  </span>
                </div>
              </article>
            </div>
          </div>
        </div>
      </template>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

type ReportSummary = {
  name: string;
  createdAt?: string;
  hasSummary?: boolean;
};

type Recommendation = {
  id: string;
  title: string;
  rationale?: string;
  snippet?: string;
  session?: string;
  tags?: string[];
};

type RecommendationsPayload = {
  tagsSummary?: Record<string, number>;
  observations?: Recommendation[];
};

const reports = ref<ReportSummary[]>([]);
const activeReport = ref<ReportSummary | null>(null);
const reportSummary = ref('');
const reportRecommendations = ref<RecommendationsPayload | null>(null);

const sortedTagSummary = computed(() => {
  if (!reportRecommendations.value?.tagsSummary) return [] as { name: string; count: number }[];
  return Object.entries(reportRecommendations.value.tagsSummary)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
});

function formatTimestamp(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function shortenSession(session: string) {
  if (!session) return '';
  if (session.length <= 20) return session;
  return session.slice(0, 8) + '...' + session.slice(-8);
}

async function loadReports() {
  reportSummary.value = '';
  reportRecommendations.value = null;
  const response = await fetch('/api/reports');
  const data = await response.json();
  reports.value = data.reports || [];
}

async function selectReport(report: ReportSummary) {
  activeReport.value = report;
  const response = await fetch(`/api/report?name=${encodeURIComponent(report.name)}`);
  const data = await response.json();
  reportSummary.value = data.summary || '';
  reportRecommendations.value = data.recommendations || null;
}

onMounted(() => {
  loadReports();
});
</script>
