<template>
  <main class="px-8 pb-8">
    <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div class="space-y-3 overflow-auto pr-2">
        <button
          v-for="report in reports"
          :key="report.name"
          class="w-full rounded-xl border border-transparent bg-slate-50 px-4 py-3 text-left hover:border-accent dark:bg-slate-900/60"
          :class="activeReport?.name === report.name ? 'border-accent bg-blue-50/60 dark:bg-slate-800/60' : ''"
          @click="selectReport(report)"
        >
          <div class="font-semibold">{{ report.name }}</div>
          <div class="text-xs text-slate-500 dark:text-slate-400">{{ formatTimestamp(report.createdAt) }}</div>
        </button>
      </div>
      <div class="space-y-4 overflow-auto">
        <pre v-if="reportSummary" class="rounded-xl bg-slate-900/90 p-4 text-xs text-slate-100">{{ reportSummary }}</pre>
        <div v-if="reportRecommendations" class="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h3 class="text-sm font-semibold">Observations</h3>
          <div class="mt-2 flex flex-wrap gap-2">
            <span
              v-for="tag in sortedTagSummary"
              :key="tag.name"
              class="rounded-full bg-blue-100 px-3 py-1 text-xs dark:bg-blue-900/40 dark:text-blue-100"
            >
              {{ tag.name }} ({{ tag.count }})
            </span>
          </div>
          <div class="mt-4 space-y-3">
            <article v-for="obs in reportRecommendations.observations" :key="obs.id + obs.snippet" class="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/70">
              <div class="text-sm font-semibold">{{ obs.title }}</div>
              <div class="text-xs text-slate-500 dark:text-slate-400">{{ obs.session }}</div>
              <p class="mt-2 text-sm text-slate-600 dark:text-slate-300">{{ obs.rationale }}</p>
              <pre class="mt-2 rounded-lg bg-slate-900/90 p-3 text-xs text-slate-100">{{ obs.snippet }}</pre>
            </article>
          </div>
        </div>
      </div>
    </div>
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
  if (!value) return 'Unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
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
