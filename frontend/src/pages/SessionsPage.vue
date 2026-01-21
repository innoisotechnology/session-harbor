<template>
  <main class="grid gap-6 px-8 pb-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
    <section class="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-soft dark:border-slate-800 dark:bg-slate-900/80">
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <label class="flex flex-1 flex-col text-sm text-slate-500 dark:text-slate-400">
          <span>Search sessions</span>
          <input
            v-model="searchTerm"
            type="text"
            placeholder="cwd, id, or filename"
            class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-inner dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
        <button class="rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-300" @click="reloadAll">
          Reload
        </button>
      </div>

      <div v-if="listMode === 'projects'" class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">Projects</h2>
        </div>
        <label class="flex flex-col text-sm text-slate-500 dark:text-slate-400">
          <span>Find a project</span>
          <input
            v-model="projectSearch"
            type="text"
            placeholder="Type to filter projects"
            class="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
        <div class="max-h-[520px] space-y-2 overflow-auto pr-2">
          <button
            class="w-full rounded-xl border border-transparent bg-slate-50 px-4 py-3 text-left text-sm hover:border-accent dark:bg-slate-900/60"
            :class="!selectedProject ? 'border-accent bg-blue-50/60 dark:bg-slate-800/60' : ''"
            @click="selectProject('')"
          >
            All sessions ({{ totalProjectsCount }})
          </button>
          <button
            v-for="project in filteredProjects"
            :key="project.path"
            class="w-full rounded-xl border border-transparent bg-slate-50 px-4 py-3 text-left text-sm hover:border-accent dark:bg-slate-900/60"
            :class="selectedProject === project.path ? 'border-accent bg-blue-50/60 dark:bg-slate-800/60' : ''"
            @click="selectProject(project.path)"
          >
            {{ project.path }} ({{ project.count }})
          </button>
        </div>
      </div>

      <div v-else class="space-y-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <button class="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-300" @click="showProjects">
              Back
            </button>
            <div>
              <h2 class="text-lg font-semibold">Session List</h2>
              <p class="text-xs text-slate-500 dark:text-slate-400">{{ selectedProject || 'All sessions' }}</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button
              class="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-300"
              :disabled="!selectedProject || activeSource === 'copilot'"
              @click="startNewSession"
            >
              New Session
            </button>
            <button
              class="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-rose-500 dark:border-slate-700 dark:text-rose-400"
              :disabled="!activeSession"
              @click="archiveSession"
            >
              Archive
            </button>
            <span class="text-xs text-slate-500 dark:text-slate-400">{{ filteredSessions.length }} sessions</span>
          </div>
        </div>

        <div class="max-h-[520px] space-y-3 overflow-auto pr-2">
          <button
            v-for="session in filteredSessions"
            :key="session.relPath"
            class="w-full rounded-2xl border border-transparent bg-slate-50 px-4 py-3 text-left hover:border-accent dark:bg-slate-900/60"
            :class="activeSession?.relPath === session.relPath ? 'border-accent bg-blue-50/60 dark:bg-slate-800/60' : ''"
            @click="selectSession(session)"
          >
            <div class="font-semibold">{{ session.name || session.fileName }}</div>
            <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
              <div>{{ formatTimestamp(session.timestamp) }}</div>
              <div>{{ session.project || session.cwd || 'Unknown project' }}</div>
              <div v-if="typeof session.messageCount === 'number'">{{ session.messageCount }} msgs</div>
            </div>
          </button>
          <div v-if="filteredSessions.length === 0" class="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            No sessions match your filters.
          </div>
        </div>
      </div>
    </section>

    <section class="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-soft dark:border-slate-800 dark:bg-slate-900/80">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <h2 class="text-lg font-semibold">Details</h2>
        <div class="flex items-center gap-2">
          <div class="flex rounded-full border border-slate-200 bg-white/70 p-1 dark:border-slate-700 dark:bg-slate-900/70">
            <button
              class="rounded-full px-3 py-1 text-xs"
              :class="activeTab === 'messages' ? 'bg-white text-slate-900 shadow dark:bg-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'"
              @click="activeTab = 'messages'"
            >
              Messages
            </button>
            <button
              class="rounded-full px-3 py-1 text-xs"
              :class="activeTab === 'raw' ? 'bg-white text-slate-900 shadow dark:bg-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'"
              @click="activeTab = 'raw'"
            >
              Raw JSONL
            </button>
          </div>
          <button
            class="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-300"
            :disabled="activeSource !== 'codex' || !activeSession?.id"
            @click="rejoinSession"
          >
            Rejoin
          </button>
          <button
            class="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-300"
            :disabled="activeSource !== 'codex' || !activeSession?.id"
            @click="focusSession"
          >
            Focus
          </button>
        </div>
      </div>

      <div class="mt-4">
        <div v-if="!activeSession" class="text-sm text-slate-500 dark:text-slate-400">Select a session to view its content.</div>
        <div v-else>
          <div class="grid gap-3 md:grid-cols-2">
            <div class="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/70">
              <p class="text-xs uppercase text-slate-500 dark:text-slate-400">File</p>
              <p class="text-sm">{{ activeSession.relPath }}</p>
            </div>
            <div class="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/70">
              <p class="text-xs uppercase text-slate-500 dark:text-slate-400">Project</p>
              <p class="text-sm">{{ activeSession.project || activeSession.cwd || 'Unknown' }}</p>
            </div>
            <div class="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/70">
              <p class="text-xs uppercase text-slate-500 dark:text-slate-400">Timestamp</p>
              <p class="text-sm">{{ formatTimestamp(activeSession.timestamp) }}</p>
            </div>
            <div class="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/70">
              <p class="text-xs uppercase text-slate-500 dark:text-slate-400">Session ID</p>
              <p class="text-sm">{{ activeSession.id || 'Unknown' }}</p>
            </div>
          </div>

          <div class="mt-4">
            <div v-if="activeTab === 'raw'" class="rounded-xl bg-slate-900/90 p-4 text-xs text-slate-100">
              <pre>{{ activeSessionDetail?.content }}</pre>
            </div>
            <div v-else class="space-y-4">
              <article
                v-for="(message, idx) in activeSessionDetail?.messages || []"
                :key="idx"
                class="rounded-xl border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <header class="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span class="uppercase tracking-wide">{{ message.role }}</span>
                  <span>{{ formatTimestamp(message.timestamp) }}</span>
                </header>
                <pre class="mt-2 text-sm text-slate-700 whitespace-pre-wrap dark:text-slate-200">{{ message.text }}</pre>
              </article>
            </div>
          </div>
        </div>
      </div>

      <div class="mt-4 flex items-end gap-3">
        <label class="flex flex-1 flex-col text-sm text-slate-500 dark:text-slate-400">
          <span>Session name</span>
          <input
            v-model="sessionName"
            type="text"
            placeholder="Add a label"
            class="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
        <button class="rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-300" :disabled="!activeSession" @click="saveSessionName">
          Save name
        </button>
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
  matchCount?: number;
};

type SessionMessage = {
  role: string;
  timestamp?: string;
  text: string;
};

type SessionDetail = {
  relPath: string;
  content: string;
  messages: SessionMessage[];
  meta?: { sessionId?: string; cwd?: string };
};

type ProjectSummary = {
  path: string;
  count: number;
};

const { activeSource } = useSourceStore();
const sessions = ref<Session[]>([]);
const filteredSessions = ref<Session[]>([]);
const projects = ref<ProjectSummary[]>([]);
const filteredProjects = ref<ProjectSummary[]>([]);
const activeSession = ref<Session | null>(null);
const activeSessionDetail = ref<SessionDetail | null>(null);
const listMode = ref<'projects' | 'sessions'>('projects');
const activeTab = ref<'messages' | 'raw'>('messages');
const selectedProject = ref('');
const searchTerm = ref('');
const projectSearch = ref('');
const sessionName = ref('');
let searchTimer: ReturnType<typeof setTimeout> | null = null;

const totalProjectsCount = computed(() => filteredProjects.value.reduce((sum, item) => sum + item.count, 0));

function sessionsEndpoint(source: string) {
  if (source === 'claude') return '/api/claude/sessions';
  if (source === 'copilot') return '/api/copilot/sessions';
  return '/api/sessions';
}

function sessionEndpoint(source: string) {
  if (source === 'claude') return '/api/claude/session';
  if (source === 'copilot') return '/api/copilot/session';
  return '/api/session';
}

function formatTimestamp(value?: string) {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function applyFilters() {
  const search = searchTerm.value.trim().toLowerCase();
  const project = selectedProject.value;
  filteredSessions.value = sessions.value.filter((session) => {
    if (project && (session.project || session.cwd || 'Unknown') !== project) return false;
    if (!search) return true;
    const haystack = [session.name, session.fileName, session.project, session.cwd, session.id, session.relPath]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(search);
  });
}

async function fetchSessions() {
  const response = await fetch(sessionsEndpoint(activeSource.value));
  const data = await response.json();
  sessions.value = data.sessions || [];
  filteredSessions.value = sessions.value;
  applyFilters();
}

async function fetchProjects() {
  const response = await fetch(`/api/projects?source=${encodeURIComponent(activeSource.value)}`);
  const data = await response.json();
  projects.value = Array.isArray(data.projects) ? data.projects : [];
  filteredProjects.value = projects.value;
}

async function searchSessions(query: string) {
  const params = new URLSearchParams({ source: activeSource.value, query });
  if (selectedProject.value) params.set('project', selectedProject.value);
  const response = await fetch(`/api/search?${params.toString()}`);
  const data = await response.json();
  sessions.value = data.sessions || [];
  filteredSessions.value = sessions.value;
}

async function selectSession(session: Session) {
  activeSession.value = session;
  sessionName.value = session.name || '';
  activeTab.value = 'messages';
  const response = await fetch(`${sessionEndpoint(activeSource.value)}?file=${encodeURIComponent(session.relPath)}`);
  const data = await response.json();
  activeSessionDetail.value = data;
}

async function saveSessionName() {
  if (!activeSession.value) return;
  await fetch('/api/name', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: activeSource.value,
      relPath: activeSession.value.relPath,
      name: sessionName.value.trim()
    })
  });
  await fetchSessions();
}

function selectProject(path: string) {
  selectedProject.value = path;
  listMode.value = 'sessions';
  applyFilters();
}

function showProjects() {
  listMode.value = 'projects';
}

async function archiveSession() {
  if (!activeSession.value) return;
  await fetch('/api/archive-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: activeSource.value,
      relPath: activeSession.value.relPath
    })
  });
  activeSession.value = null;
  activeSessionDetail.value = null;
  await fetchSessions();
  await fetchProjects();
}

async function startNewSession() {
  if (!selectedProject.value) return;
  await fetch(`/api/new-session?source=${encodeURIComponent(activeSource.value)}&cwd=${encodeURIComponent(selectedProject.value)}&name=${encodeURIComponent('')}`);
}

async function rejoinSession() {
  if (!activeSession.value?.id) return;
  await fetch(`/api/resume?sessionId=${encodeURIComponent(activeSession.value.id)}`);
}

async function focusSession() {
  if (!activeSession.value?.id) return;
  await fetch(`/api/focus?sessionId=${encodeURIComponent(activeSession.value.id)}`);
}

function reloadAll() {
  fetchSessions();
  fetchProjects();
}

watch(projectSearch, (value) => {
  const term = value.trim().toLowerCase();
  if (!term) {
    filteredProjects.value = projects.value;
    return;
  }
  filteredProjects.value = projects.value.filter((project) => project.path.toLowerCase().includes(term));
});

watch(searchTerm, (value) => {
  if (searchTimer) clearTimeout(searchTimer);
  const query = value.trim();
  if (!query) {
    fetchSessions();
    return;
  }
  searchTimer = setTimeout(() => {
    searchSessions(query);
  }, 250);
});

watch(activeSource, () => {
  activeSession.value = null;
  activeSessionDetail.value = null;
  listMode.value = 'projects';
  selectedProject.value = '';
  searchTerm.value = '';
  projectSearch.value = '';
  fetchSessions();
  fetchProjects();
});

onMounted(async () => {
  await fetchSessions();
  await fetchProjects();
});
</script>
