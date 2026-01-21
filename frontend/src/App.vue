<template>
  <div class="min-h-screen bg-mist text-ink">
    <header class="flex flex-wrap items-center justify-between gap-6 px-8 py-6">
      <div class="flex items-center gap-4">
        <div class="relative grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-accent to-sky-400 shadow-[0_14px_30px_rgba(37,99,235,0.35)]">
          <div class="absolute h-7 w-7 rounded-full border border-white/70"></div>
          <div class="h-3 w-3 rounded-full bg-cyan-200 shadow-[0_0_14px_rgba(94,242,255,0.9)]"></div>
        </div>
        <div>
          <p class="text-xs uppercase tracking-[0.2em] text-slate-500">Session Harbor</p>
          <h1 class="text-2xl font-semibold">Dock, scan, and relaunch your AI sessions.</h1>
          <p class="text-sm text-slate-500">A local harbor for Codex and Claude session logs.</p>
        </div>
      </div>

      <div class="flex flex-wrap items-end gap-3">
        <label class="flex flex-col text-sm text-slate-500">
          <span>Search sessions</span>
          <input
            v-model="searchTerm"
            type="text"
            placeholder="cwd, id, or filename"
            class="mt-1 w-56 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-inner"
          />
        </label>
        <button class="rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:border-accent hover:text-slate-900" @click="loadStatus">
          Status
        </button>
        <button class="rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:border-accent hover:text-slate-900" @click="loadReports">
          Reports
        </button>
        <div class="flex rounded-full border border-slate-200 bg-white/60 p-1 shadow-inner">
          <button
            class="rounded-full px-4 py-1.5 text-sm"
            :class="activeSource === 'codex' ? 'bg-white text-slate-900 shadow' : 'text-slate-500'"
            @click="setSource('codex')"
          >
            Codex
          </button>
          <button
            class="rounded-full px-4 py-1.5 text-sm"
            :class="activeSource === 'claude' ? 'bg-white text-slate-900 shadow' : 'text-slate-500'"
            @click="setSource('claude')"
          >
            Claude
          </button>
        </div>
      </div>
    </header>

    <main class="grid gap-6 px-8 pb-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <section class="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-soft">
        <div v-if="listMode === 'projects'" class="space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold">Projects</h2>
          </div>
          <label class="flex flex-col text-sm text-slate-500">
            <span>Find a project</span>
            <input
              v-model="projectSearch"
              type="text"
              placeholder="Type to filter projects"
              class="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <div class="max-h-[520px] space-y-2 overflow-auto pr-2">
            <button
              class="w-full rounded-xl border border-transparent bg-slate-50 px-4 py-3 text-left text-sm hover:border-accent"
              :class="!selectedProject ? 'border-accent bg-blue-50/60' : ''"
              @click="selectProject('')"
            >
              All sessions ({{ totalProjectsCount }})
            </button>
            <button
              v-for="project in filteredProjects"
              :key="project.path"
              class="w-full rounded-xl border border-transparent bg-slate-50 px-4 py-3 text-left text-sm hover:border-accent"
              :class="selectedProject === project.path ? 'border-accent bg-blue-50/60' : ''"
              @click="selectProject(project.path)"
            >
              {{ project.path }} ({{ project.count }})
            </button>
          </div>
        </div>

        <div v-else class="space-y-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <button class="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-500" @click="showProjects">
                Back
              </button>
              <div>
                <h2 class="text-lg font-semibold">Session List</h2>
                <p class="text-xs text-slate-500">{{ selectedProject || 'All sessions' }}</p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button
                class="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-500"
                :disabled="!selectedProject"
                @click="startNewSession"
              >
                New Session
              </button>
              <button
                class="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-rose-500"
                :disabled="!activeSession"
                @click="archiveSession"
              >
                Archive
              </button>
              <span class="text-xs text-slate-500">{{ filteredSessions.length }} sessions</span>
            </div>
          </div>

          <div class="max-h-[520px] space-y-3 overflow-auto pr-2">
            <button
              v-for="session in filteredSessions"
              :key="session.relPath"
              class="w-full rounded-2xl border border-transparent bg-slate-50 px-4 py-3 text-left hover:border-accent"
              :class="activeSession?.relPath === session.relPath ? 'border-accent bg-blue-50/60' : ''"
              @click="selectSession(session)"
            >
              <div class="font-semibold">{{ session.name || session.fileName }}</div>
              <div class="mt-1 text-xs text-slate-500">
                <div>{{ formatTimestamp(session.timestamp) }}</div>
                <div>{{ session.project || session.cwd || 'Unknown project' }}</div>
                <div v-if="typeof session.messageCount === 'number'">{{ session.messageCount }} msgs</div>
              </div>
            </button>
            <div v-if="filteredSessions.length === 0" class="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">
              No sessions match your filters.
            </div>
          </div>
        </div>
      </section>

      <section class="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-soft">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <h2 class="text-lg font-semibold">Details</h2>
          <div class="flex items-center gap-2">
            <div class="flex rounded-full border border-slate-200 bg-white/70 p-1">
              <button
                class="rounded-full px-3 py-1 text-xs"
                :class="activeTab === 'messages' ? 'bg-white text-slate-900 shadow' : 'text-slate-500'"
                @click="activeTab = 'messages'"
              >
                Messages
              </button>
              <button
                class="rounded-full px-3 py-1 text-xs"
                :class="activeTab === 'raw' ? 'bg-white text-slate-900 shadow' : 'text-slate-500'"
                @click="activeTab = 'raw'"
              >
                Raw JSONL
              </button>
            </div>
            <button
              class="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-500"
              :disabled="activeSource !== 'codex' || !activeSession?.id"
              @click="rejoinSession"
            >
              Rejoin
            </button>
            <button
              class="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-500"
              :disabled="activeSource !== 'codex' || !activeSession?.id"
              @click="focusSession"
            >
              Focus
            </button>
            <button class="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-500" @click="reloadAll">
              Reload
            </button>
          </div>
        </div>

        <div class="mt-4">
          <template v-if="detailMode === 'status'">
            <div v-if="statusData" class="rounded-2xl border border-slate-200 bg-white p-5">
              <div class="flex items-center justify-between">
                <div class="text-sm font-semibold">{{ statusData.source === 'claude' ? 'Claude' : 'Codex' }} Status</div>
                <div class="text-xs text-slate-500">{{ statusData.cliVersion || 'Version unknown' }}</div>
              </div>
              <div class="mt-4 grid gap-3 md:grid-cols-2">
                <div class="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <p class="text-xs uppercase text-slate-500">Model</p>
                  <p class="text-sm">{{ statusData.model || 'Unknown' }}</p>
                </div>
                <div class="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <p class="text-xs uppercase text-slate-500">Account</p>
                  <p class="text-sm">{{ statusData.account?.email || '' }}</p>
                  <p class="text-xs text-slate-500">{{ statusData.account?.tier || 'Tier unknown' }}</p>
                </div>
              </div>
            </div>
            <div v-else class="text-sm text-slate-500">Loading status...</div>
          </template>

          <template v-else-if="detailMode === 'reports'">
            <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <div class="space-y-3 overflow-auto pr-2">
                <button
                  v-for="report in reports"
                  :key="report.name"
                  class="w-full rounded-xl border border-transparent bg-slate-50 px-4 py-3 text-left hover:border-accent"
                  :class="activeReport?.name === report.name ? 'border-accent bg-blue-50/60' : ''"
                  @click="selectReport(report)"
                >
                  <div class="font-semibold">{{ report.name }}</div>
                  <div class="text-xs text-slate-500">{{ formatTimestamp(report.createdAt) }}</div>
                </button>
              </div>
              <div class="space-y-4 overflow-auto">
                <pre v-if="reportSummary" class="rounded-xl bg-slate-900/90 p-4 text-xs text-slate-100">{{ reportSummary }}</pre>
                <div v-if="reportRecommendations" class="rounded-xl border border-slate-200 bg-white p-4">
                  <h3 class="text-sm font-semibold">Observations</h3>
                  <div class="mt-2 flex flex-wrap gap-2">
                    <span
                      v-for="tag in sortedTagSummary"
                      :key="tag.name"
                      class="rounded-full bg-blue-100 px-3 py-1 text-xs"
                    >
                      {{ tag.name }} ({{ tag.count }})
                    </span>
                  </div>
                  <div class="mt-4 space-y-3">
                    <article v-for="obs in reportRecommendations.observations" :key="obs.id + obs.snippet" class="rounded-xl border border-slate-100 bg-slate-50 p-3">
                      <div class="text-sm font-semibold">{{ obs.title }}</div>
                      <div class="text-xs text-slate-500">{{ obs.session }}</div>
                      <p class="mt-2 text-sm text-slate-600">{{ obs.rationale }}</p>
                      <pre class="mt-2 rounded-lg bg-slate-900/90 p-3 text-xs text-slate-100">{{ obs.snippet }}</pre>
                    </article>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <template v-else>
            <div v-if="!activeSession" class="text-sm text-slate-500">Select a session to view its content.</div>
            <div v-else>
              <div class="grid gap-3 md:grid-cols-2">
                <div class="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <p class="text-xs uppercase text-slate-500">File</p>
                  <p class="text-sm">{{ activeSession.relPath }}</p>
                </div>
                <div class="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <p class="text-xs uppercase text-slate-500">Project</p>
                  <p class="text-sm">{{ activeSession.project || activeSession.cwd || 'Unknown' }}</p>
                </div>
                <div class="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <p class="text-xs uppercase text-slate-500">Timestamp</p>
                  <p class="text-sm">{{ formatTimestamp(activeSession.timestamp) }}</p>
                </div>
                <div class="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <p class="text-xs uppercase text-slate-500">Session ID</p>
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
                    class="rounded-xl border border-slate-100 bg-white p-4"
                  >
                    <header class="flex items-center justify-between text-xs text-slate-500">
                      <span class="uppercase tracking-wide">{{ message.role }}</span>
                      <span>{{ formatTimestamp(message.timestamp) }}</span>
                    </header>
                    <pre class="mt-2 text-sm text-slate-700 whitespace-pre-wrap">{{ message.text }}</pre>
                  </article>
                </div>
              </div>
            </div>
          </template>
        </div>

        <div v-if="detailMode === 'session'" class="mt-4 flex items-end gap-3">
          <label class="flex flex-1 flex-col text-sm text-slate-500">
            <span>Session name</span>
            <input v-model="sessionName" type="text" placeholder="Add a label" class="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900" />
          </label>
          <button class="rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-500" :disabled="!activeSession" @click="saveSessionName">
            Save name
          </button>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';

const sessions = ref([]);
const filteredSessions = ref([]);
const projects = ref([]);
const filteredProjects = ref([]);
const activeSession = ref(null);
const activeSessionDetail = ref(null);
const activeSource = ref('codex');
const listMode = ref('projects');
const detailMode = ref('session');
const activeTab = ref('messages');
const selectedProject = ref('');
const searchTerm = ref('');
const projectSearch = ref('');
const sessionName = ref('');
const statusData = ref(null);
const reports = ref([]);
const activeReport = ref(null);
const reportSummary = ref('');
const reportRecommendations = ref(null);
let searchTimer = null;

const totalProjectsCount = computed(() => filteredProjects.value.reduce((sum, item) => sum + item.count, 0));
const sortedTagSummary = computed(() => {
  if (!reportRecommendations.value?.tagsSummary) return [];
  return Object.entries(reportRecommendations.value.tagsSummary)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
});

function formatTimestamp(value) {
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
  const endpoint = activeSource.value === 'claude' ? '/api/claude/sessions' : '/api/sessions';
  const response = await fetch(endpoint);
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

async function searchSessions(query) {
  const params = new URLSearchParams({ source: activeSource.value, query });
  if (selectedProject.value) params.set('project', selectedProject.value);
  const response = await fetch(`/api/search?${params.toString()}`);
  const data = await response.json();
  sessions.value = data.sessions || [];
  filteredSessions.value = sessions.value;
}

async function selectSession(session) {
  activeSession.value = session;
  sessionName.value = session.name || '';
  detailMode.value = 'session';
  activeTab.value = 'messages';
  const endpoint = activeSource.value === 'claude' ? '/api/claude/session' : '/api/session';
  const response = await fetch(`${endpoint}?file=${encodeURIComponent(session.relPath)}`);
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

function selectProject(path) {
  selectedProject.value = path;
  listMode.value = 'sessions';
  applyFilters();
}

function showProjects() {
  listMode.value = 'projects';
}

async function loadStatus() {
  detailMode.value = 'status';
  statusData.value = null;
  const endpoint = activeSource.value === 'claude' ? '/api/claude/status' : '/api/status';
  const response = await fetch(endpoint);
  statusData.value = await response.json();
}

async function loadReports() {
  detailMode.value = 'reports';
  reportSummary.value = '';
  reportRecommendations.value = null;
  const response = await fetch('/api/reports');
  const data = await response.json();
  reports.value = data.reports || [];
}

async function selectReport(report) {
  activeReport.value = report;
  const response = await fetch(`/api/report?name=${encodeURIComponent(report.name)}`);
  const data = await response.json();
  reportSummary.value = data.summary || '';
  reportRecommendations.value = data.recommendations || null;
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
}

async function startNewSession() {
  if (!selectedProject.value) return;
  const name = window.prompt('Session name (optional)', '');
  if (name === null) return;
  await fetch(`/api/new-session?source=${encodeURIComponent(activeSource.value)}&cwd=${encodeURIComponent(selectedProject.value)}&name=${encodeURIComponent(name.trim())}`);
}

async function rejoinSession() {
  if (!activeSession.value?.id) return;
  await fetch(`/api/resume?sessionId=${encodeURIComponent(activeSession.value.id)}`);
}

async function focusSession() {
  if (!activeSession.value?.id) return;
  await fetch(`/api/focus?sessionId=${encodeURIComponent(activeSession.value.id)}`);
}

function setSource(source) {
  activeSource.value = source;
  activeSession.value = null;
  activeSessionDetail.value = null;
  detailMode.value = 'session';
  listMode.value = 'projects';
  selectedProject.value = '';
  searchTerm.value = '';
  projectSearch.value = '';
  fetchSessions();
  fetchProjects();
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

onMounted(async () => {
  await fetchSessions();
  await fetchProjects();
});
</script>
