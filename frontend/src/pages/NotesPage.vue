<template>
  <main class="flex h-[calc(100vh-88px)] flex-col gap-px bg-surface-200 dark:bg-surface-800">
    <section class="flex flex-1 flex-col bg-surface-50 dark:bg-surface-900">
      <div class="flex items-center gap-3 border-b border-surface-200 px-6 py-3 dark:border-surface-800">
        <div class="flex-1">
          <div class="flex items-center gap-3">
            <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">Notes</h2>
            <span class="rounded-full bg-surface-100 px-2 py-0.5 text-2xs font-medium text-surface-500 dark:bg-surface-800 dark:text-surface-300">
              {{ filteredNotes.length }}
            </span>
          </div>
          <p class="mt-1 text-xs text-surface-500">Sessions with notes for the current source.</p>
        </div>
        <div class="flex items-center gap-2">
          <div class="relative">
            <svg class="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              v-model="searchTerm"
              type="text"
              placeholder="Filter notes..."
              class="w-56 rounded-md border border-surface-200 bg-white py-1.5 pl-8 pr-3 text-xs text-surface-700 placeholder:text-surface-400 focus:border-terminal-400 focus:outline-none dark:border-surface-700 dark:bg-surface-800 dark:text-surface-200"
            />
          </div>
          <button
            class="flex h-8 items-center justify-center rounded-md border border-surface-200 px-2.5 text-xs font-medium text-surface-600 transition-colors hover:bg-surface-100 hover:text-surface-700 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800 dark:hover:text-surface-200"
            @click="refreshNotes"
          >
            Reload
          </button>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto px-6 py-5">
        <div v-if="isLoading" class="flex items-center gap-2 text-sm text-surface-400">
          <svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="9" class="opacity-25"/>
            <path d="M21 12a9 9 0 0 0-9-9" class="opacity-75"/>
          </svg>
          Loading notes...
        </div>

        <div v-else-if="filteredNotes.length === 0" class="flex flex-col items-center justify-center py-16 text-center text-surface-400">
          <p class="text-sm font-medium text-surface-500">No notes yet.</p>
          <p class="mt-1 text-xs">Add notes on a session to see them here.</p>
        </div>

        <div v-else class="space-y-4">
          <article
            v-for="session in filteredNotes"
            :key="session.relPath"
            class="rounded-lg border border-surface-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-surface-800 dark:bg-surface-950"
          >
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="truncate text-sm font-semibold text-surface-900 dark:text-surface-100" :title="session.name || session.fileName">
                    {{ session.name || session.fileName }}
                  </h3>
                  <span v-if="session.status === 'complete'" class="rounded-full bg-emerald-500/10 px-2 py-0.5 text-2xs font-medium text-emerald-600 dark:text-emerald-400">Complete</span>
                  <span v-if="session.status === 'archived'" class="rounded-full bg-slate-500/10 px-2 py-0.5 text-2xs font-medium text-slate-500 dark:text-slate-300">Archived</span>
                  <span v-if="session.messageCount" class="font-mono text-2xs text-surface-400">{{ session.messageCount }} msgs</span>
                </div>
                <div class="mt-1 flex flex-wrap items-center gap-2 text-2xs text-surface-500">
                  <span class="font-mono">{{ formatTimestamp(session.timestamp) }}</span>
                  <span v-if="session.project || session.cwd" class="truncate font-mono text-surface-400" :title="session.project || session.cwd">
                    {{ session.project || session.cwd }}
                  </span>
                </div>
              </div>
              <RouterLink
                :to="`/sessions?relPath=${encodeURIComponent(session.relPath)}`"
                class="shrink-0 rounded-md border border-terminal-500/40 px-2.5 py-1 text-xs font-medium text-terminal-600 transition-colors hover:bg-terminal-500/10 dark:text-terminal-400"
              >
                View session
              </RouterLink>
            </div>

            <p class="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-surface-700 dark:text-surface-200">
              {{ session.notes }}
            </p>

            <div v-if="session.tags?.length" class="mt-3 flex flex-wrap gap-1">
              <span
                v-for="tag in session.tags"
                :key="tag"
                class="rounded-full bg-surface-100 px-2 py-0.5 text-2xs text-surface-500 dark:bg-surface-800 dark:text-surface-300"
              >
                {{ tag }}
              </span>
            </div>
          </article>
        </div>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useSourceStore } from '../store/source';

type Session = {
  id?: string;
  timestamp?: string;
  cwd?: string;
  project?: string;
  relPath: string;
  fileName: string;
  name?: string;
  messageCount?: number;
  status?: string;
  tags?: string[];
  notes?: string;
};

const { activeSource } = useSourceStore();
const sessions = ref<Session[]>([]);
const searchTerm = ref('');
const isLoading = ref(false);

const filteredNotes = computed(() => {
  const query = searchTerm.value.trim().toLowerCase();
  return sessions.value
    .filter((session) => typeof session.notes === 'string' && session.notes.trim().length > 0)
    .filter((session) => session.status !== 'archived' && session.status !== 'complete')
    .filter((session) => {
      if (!query) return true;
      const haystack = [
        session.name,
        session.fileName,
        session.project,
        session.cwd,
        session.notes,
        ...(session.tags || [])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => {
      const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return bTime - aTime;
    });
});

function sessionsEndpoint(source: string) {
  if (source === 'claude') return '/api/claude/sessions';
  if (source === 'copilot') return '/api/copilot/sessions';
  return '/api/sessions';
}

function formatTimestamp(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function fetchSessions() {
  isLoading.value = true;
  try {
    const response = await fetch(sessionsEndpoint(activeSource.value));
    const data = await response.json();
    sessions.value = data.sessions || [];
  } finally {
    isLoading.value = false;
  }
}

function refreshNotes() {
  fetchSessions();
}

onMounted(() => {
  fetchSessions();
});

watch(activeSource, () => {
  fetchSessions();
});
</script>
