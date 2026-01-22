<template>
  <main class="flex h-[calc(100vh-88px)] gap-px bg-surface-200 dark:bg-surface-800">
    <!-- Left Panel: Projects/Sessions List -->
    <section class="flex w-80 flex-col bg-surface-50 dark:bg-surface-900">
      <!-- Search & Actions -->
      <div class="flex items-center gap-2 border-b border-surface-200 p-3 dark:border-surface-800">
        <div class="relative flex-1">
          <svg class="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            v-model="searchTerm"
            type="text"
            placeholder="Search sessions..."
            :aria-busy="isSearching ? 'true' : 'false'"
            class="w-full rounded-md border border-surface-200 bg-white py-1.5 pl-8 pr-8 text-sm text-surface-900 placeholder:text-surface-400 focus:border-terminal-400 focus:outline-none dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100"
          />
          <div
            class="absolute right-2.5 top-1/2 -translate-y-1/2 text-surface-400 transition-opacity"
            :class="isSearching ? 'opacity-100' : 'opacity-0'"
            aria-hidden="true"
          >
            <svg class="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="9" class="opacity-25"/>
              <path d="M21 12a9 9 0 0 0-9-9" class="opacity-75"/>
            </svg>
          </div>
        </div>
        <button
          class="flex h-8 w-8 items-center justify-center rounded-md border border-surface-200 text-surface-500 transition-colors hover:bg-surface-100 hover:text-surface-700 dark:border-surface-700 dark:hover:bg-surface-800 dark:hover:text-surface-200"
          @click="reloadAll"
          title="Reload"
        >
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>
      </div>

      <!-- Projects View -->
      <div v-if="listMode === 'projects'" class="flex flex-1 flex-col overflow-hidden">
        <div class="flex items-center justify-between border-b border-surface-100 px-3 py-2 dark:border-surface-800">
          <span class="text-2xs font-medium uppercase tracking-wider text-surface-400">Projects</span>
          <span class="font-mono text-2xs text-surface-400">{{ filteredProjects.length }}</span>
        </div>

        <div class="flex-1 overflow-y-auto scrollbar-thin p-2">
          <!-- All Sessions -->
          <button
            class="mb-1 flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition-colors"
            :class="!selectedProject
              ? 'bg-terminal-500/10 text-terminal-600 dark:text-terminal-400'
              : 'text-surface-600 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800'"
            @click="selectProject('')"
          >
            <span class="font-medium">All sessions</span>
            <span class="font-mono text-xs text-surface-400">{{ totalProjectsCount }}</span>
          </button>

          <!-- Project Search -->
          <div class="relative mb-2">
            <input
              v-model="projectSearch"
              type="text"
              placeholder="Filter projects..."
              class="w-full rounded-md border-0 bg-surface-100 py-1.5 px-2.5 text-xs text-surface-700 placeholder:text-surface-400 focus:outline-none focus:ring-1 focus:ring-terminal-400/50 dark:bg-surface-800 dark:text-surface-200"
            />
          </div>

          <!-- Project List -->
          <div class="space-y-0.5">
            <button
              v-for="project in filteredProjects"
              :key="project.path"
              class="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition-colors"
              :class="selectedProject === project.path
                ? 'bg-terminal-500/10 text-terminal-600 dark:text-terminal-400'
                : 'text-surface-600 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800'"
              @click="selectProject(project.path)"
            >
              <span class="truncate font-mono text-xs" :title="project.path">{{ shortenPath(project.path) }}</span>
              <span class="ml-2 shrink-0 font-mono text-2xs text-surface-400">{{ project.count }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Sessions View -->
      <div v-else class="flex flex-1 flex-col overflow-hidden">
        <div class="flex items-center gap-2 border-b border-surface-100 px-3 py-2 dark:border-surface-800">
          <button
            class="flex h-6 w-6 items-center justify-center rounded text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-600 dark:hover:bg-surface-800 dark:hover:text-surface-200"
            @click="showProjects"
          >
            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path d="m15 18-6-6 6-6"/>
            </svg>
          </button>
          <div class="flex-1 min-w-0">
            <span class="text-2xs font-medium uppercase tracking-wider text-surface-400">Sessions</span>
            <p class="truncate font-mono text-2xs text-surface-500" :title="selectedProject">{{ selectedProject || 'All' }}</p>
          </div>
          <div class="flex items-center gap-1 rounded-md border border-surface-200 p-0.5 dark:border-surface-700">
            <button
              class="rounded px-2 py-0.5 text-2xs font-medium transition-colors"
              :class="statusFilter === 'all'
                ? 'bg-surface-100 text-surface-800 dark:bg-surface-700 dark:text-surface-100'
                : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200'"
              @click="statusFilter = 'all'"
            >
              All
            </button>
            <button
              class="rounded px-2 py-0.5 text-2xs font-medium transition-colors"
              :class="statusFilter === 'active'
                ? 'bg-surface-100 text-surface-800 dark:bg-surface-700 dark:text-surface-100'
                : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200'"
              @click="statusFilter = 'active'"
            >
              Active
            </button>
            <button
              class="rounded px-2 py-0.5 text-2xs font-medium transition-colors"
              :class="statusFilter === 'complete'
                ? 'bg-surface-100 text-surface-800 dark:bg-surface-700 dark:text-surface-100'
                : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200'"
              @click="statusFilter = 'complete'"
            >
              Complete
            </button>
            <button
              class="rounded px-2 py-0.5 text-2xs font-medium transition-colors"
              :class="statusFilter === 'archived'
                ? 'bg-surface-100 text-surface-800 dark:bg-surface-700 dark:text-surface-100'
                : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200'"
              @click="statusFilter = 'archived'"
            >
              Archived
            </button>
          </div>
          <span class="font-mono text-2xs text-surface-400">{{ filteredSessions.length }}</span>
        </div>

        <!-- Session Actions -->
        <div class="flex items-center gap-1.5 border-b border-surface-100 px-3 py-2 dark:border-surface-800">
          <button
            class="rounded-md bg-terminal-500 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-terminal-600 disabled:opacity-40"
            :disabled="!selectedProject || activeSource === 'copilot'"
            @click="startNewSession"
          >
            + New
          </button>
          <button
            class="rounded-md border border-surface-200 px-2.5 py-1 text-xs font-medium text-surface-600 transition-colors hover:bg-surface-100 disabled:opacity-40 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800"
            :disabled="!activeSession"
            @click="toggleCompleteSession"
          >
            {{ activeSession?.status === 'complete' ? 'Mark active' : 'Mark complete' }}
          </button>
          <button
            class="rounded-md border border-surface-200 px-2.5 py-1 text-xs font-medium text-surface-600 transition-colors hover:bg-surface-100 disabled:opacity-40 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800"
            :disabled="!activeSession"
            @click="archiveSession"
          >
            {{ activeSession?.status === 'archived' ? 'Unarchive' : 'Archive' }}
          </button>
        </div>

        <div class="flex items-center gap-2 border-b border-surface-100 px-3 py-2 text-2xs text-surface-500 dark:border-surface-800 dark:text-surface-400">
          <input
            v-model="tagFilter"
            type="text"
            placeholder="Filter by tag..."
            class="w-32 rounded-md border border-surface-200 bg-white px-2 py-1 text-2xs text-surface-700 placeholder:text-surface-400 focus:border-terminal-400 focus:outline-none dark:border-surface-700 dark:bg-surface-800 dark:text-surface-200"
          />
          <label class="flex items-center gap-1">
            <input v-model="notesOnly" type="checkbox" class="h-3 w-3 rounded border-surface-300 text-terminal-500" />
            Has notes
          </label>
        </div>

        <!-- Session List -->
        <div class="flex-1 overflow-y-auto scrollbar-thin p-2">
          <div class="space-y-1">
            <button
              v-for="session in filteredSessions"
              :key="session.relPath"
              class="w-full rounded-md p-2.5 text-left transition-colors"
              :class="activeSession?.relPath === session.relPath
                ? 'bg-terminal-500/10 ring-1 ring-terminal-500/30'
                : 'hover:bg-surface-100 dark:hover:bg-surface-800'"
              @click="selectSession(session)"
            >
              <div class="flex items-start justify-between gap-2">
                <span class="text-sm font-medium text-surface-800 dark:text-surface-100">{{ session.name || session.fileName }}</span>
                <div class="flex items-center gap-2">
                  <span v-if="session.status === 'complete'" class="rounded-full bg-emerald-500/10 px-2 py-0.5 text-2xs font-medium text-emerald-600 dark:text-emerald-400">Complete</span>
                  <span v-if="session.status === 'archived'" class="rounded-full bg-slate-500/10 px-2 py-0.5 text-2xs font-medium text-slate-500 dark:text-slate-300">Archived</span>
                  <span v-if="session.messageCount" class="shrink-0 font-mono text-2xs text-surface-400">{{ session.messageCount }} msgs</span>
                </div>
              </div>
              <div class="mt-1 flex items-center gap-2 text-2xs text-surface-400">
                <span class="font-mono">{{ formatTimestamp(session.timestamp) }}</span>
              </div>
              <div v-if="session.tags?.length" class="mt-1 flex flex-wrap gap-1">
                <span
                  v-for="tag in session.tags"
                  :key="tag"
                  class="rounded-full bg-surface-100 px-2 py-0.5 text-2xs text-surface-500 dark:bg-surface-800 dark:text-surface-300"
                >
                  {{ tag }}
                </span>
              </div>
              <p class="mt-0.5 truncate font-mono text-2xs text-surface-400" :title="session.project || session.cwd">
                {{ shortenPath(session.project || session.cwd || '') }}
              </p>
            </button>
          </div>

          <div v-if="filteredSessions.length === 0" class="flex flex-col items-center justify-center py-12 text-center">
            <svg class="h-8 w-8 text-surface-300 dark:text-surface-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            <p class="mt-2 text-xs text-surface-400">No sessions found</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Right Panel: Session Details -->
    <section class="flex min-w-0 flex-1 flex-col bg-surface-50 dark:bg-surface-900">
      <!-- Empty State -->
      <div v-if="!activeSession" class="flex flex-1 flex-col items-center justify-center text-surface-400">
        <svg class="h-12 w-12 text-surface-200 dark:text-surface-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
        </svg>
        <p class="mt-3 text-sm">Select a session to view details</p>
      </div>

      <!-- Session Content -->
      <template v-else>
        <!-- Header -->
        <div class="flex min-w-0 items-center justify-between border-b border-surface-200 px-4 py-3 dark:border-surface-800">
          <div class="min-w-0 flex-1">
            <h2 class="truncate text-base font-semibold text-surface-900 dark:text-surface-100">
              {{ activeSession.name || activeSession.fileName }}
            </h2>
            <p class="mt-0.5 truncate font-mono text-xs text-surface-400">{{ activeSession.id || 'No ID' }}</p>
          </div>

          <div class="flex items-center gap-2">
            <!-- Tab Switcher -->
            <div class="flex rounded-md border border-surface-200 p-0.5 dark:border-surface-700">
              <button
                class="rounded px-2.5 py-1 text-xs font-medium transition-colors"
                :class="activeTab === 'messages'
                  ? 'bg-surface-100 text-surface-800 dark:bg-surface-700 dark:text-surface-100'
                  : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200'"
                @click="activeTab = 'messages'"
              >
                Messages
              </button>
              <button
                class="rounded px-2.5 py-1 text-xs font-medium transition-colors"
                :class="activeTab === 'raw'
                  ? 'bg-surface-100 text-surface-800 dark:bg-surface-700 dark:text-surface-100'
                  : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200'"
                @click="activeTab = 'raw'"
              >
                Raw
              </button>
            </div>

            <!-- Session Actions -->
            <button
              class="rounded-md border border-surface-200 px-2.5 py-1 text-xs font-medium text-surface-600 transition-colors hover:bg-surface-100 disabled:opacity-40 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800"
              :disabled="activeSource !== 'codex' || !activeSession?.id"
              @click="rejoinSession"
            >
              Rejoin
            </button>
            <button
              class="rounded-md border border-surface-200 px-2.5 py-1 text-xs font-medium text-surface-600 transition-colors hover:bg-surface-100 disabled:opacity-40 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800"
              :disabled="activeSource !== 'codex' || !activeSession?.id"
              @click="focusSession"
            >
              Focus
            </button>
          </div>
        </div>

        <!-- Metadata Grid -->
        <div class="grid min-w-0 grid-cols-4 gap-px border-b border-surface-200 bg-surface-200 dark:border-surface-800 dark:bg-surface-800">
          <div class="bg-surface-50 px-3 py-2 dark:bg-surface-900">
            <p class="text-2xs font-medium uppercase tracking-wider text-surface-400">File</p>
            <p class="mt-0.5 truncate font-mono text-xs text-surface-700 dark:text-surface-200" :title="activeSession.relPath">{{ activeSession.fileName }}</p>
          </div>
          <div class="bg-surface-50 px-3 py-2 dark:bg-surface-900">
            <p class="text-2xs font-medium uppercase tracking-wider text-surface-400">Project</p>
            <p class="mt-0.5 truncate font-mono text-xs text-surface-700 dark:text-surface-200" :title="activeSession.project || activeSession.cwd">{{ shortenPath(activeSession.project || activeSession.cwd || 'Unknown') }}</p>
          </div>
          <div class="bg-surface-50 px-3 py-2 dark:bg-surface-900">
            <p class="text-2xs font-medium uppercase tracking-wider text-surface-400">Timestamp</p>
            <p class="mt-0.5 font-mono text-xs text-surface-700 dark:text-surface-200">{{ formatTimestamp(activeSession.timestamp) }}</p>
          </div>
          <div class="bg-surface-50 px-3 py-2 dark:bg-surface-900">
            <p class="text-2xs font-medium uppercase tracking-wider text-surface-400">Messages</p>
            <p class="mt-0.5 font-mono text-xs text-surface-700 dark:text-surface-200">{{ activeSessionDetail?.messages?.length || 0 }}</p>
          </div>
        </div>

        <!-- Content Area -->
        <div
          ref="messageScrollRef"
          class="flex-1 min-w-0 overflow-y-auto overflow-x-hidden scrollbar-thin focus:outline-none"
          tabindex="0"
        >
          <!-- Raw JSONL -->
          <div v-if="activeTab === 'raw'" class="p-4">
            <pre class="overflow-x-auto rounded-lg bg-surface-900 p-4 font-mono text-xs leading-relaxed text-surface-100">{{ activeSessionDetail?.content }}</pre>
          </div>

          <!-- Messages -->
          <div v-else class="p-4">
            <div class="mx-auto w-full max-w-3xl space-y-3">
              <article
                v-for="(message, idx) in activeSessionDetail?.messages || []"
                :key="idx"
                class="flex max-h-80 flex-col overflow-hidden rounded-lg border border-surface-200 bg-white px-4 py-3 shadow-sm dark:border-surface-800 dark:bg-surface-900"
              >
                <header class="flex items-center gap-2 border-b border-surface-100 pb-2 dark:border-surface-800">
                  <span
                    class="rounded px-1.5 py-0.5 font-mono text-2xs font-medium uppercase"
                    :class="message.role === 'user'
                      ? 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400'
                      : 'bg-terminal-500/10 text-terminal-600 dark:text-terminal-400'"
                  >
                    {{ message.role }}
                  </span>
                  <span class="font-mono text-2xs text-surface-400">{{ formatTimestamp(message.timestamp) }}</span>
                </header>
                <div class="mt-2 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-surface-700 scrollbar-thin dark:text-surface-200">
                  {{ message.text }}
                </div>
              </article>
            </div>
          </div>
        </div>

        <!-- Session Name Input -->
        <div class="flex items-center gap-2 border-t border-surface-200 px-4 py-3 dark:border-surface-800">
          <input
            v-model="sessionName"
            type="text"
            placeholder="Add a label to this session..."
            class="flex-1 rounded-md border border-surface-200 bg-white px-3 py-1.5 text-sm text-surface-900 placeholder:text-surface-400 focus:border-terminal-400 focus:outline-none dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100"
          />
          <button
            class="rounded-md bg-terminal-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-terminal-600 disabled:opacity-40"
            :disabled="!activeSession"
            @click="saveSessionName"
          >
            Save
          </button>
        </div>

        <div class="border-t border-surface-200 px-4 py-3 dark:border-surface-800">
          <div class="flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <input
                v-model="tagInput"
                type="text"
                placeholder="Tags (comma separated)"
                class="flex-1 rounded-md border border-surface-200 bg-white px-3 py-1.5 text-sm text-surface-900 placeholder:text-surface-400 focus:border-terminal-400 focus:outline-none dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100"
              />
              <button
                class="rounded-md border border-surface-200 px-3 py-1.5 text-sm font-medium text-surface-600 transition-colors hover:bg-surface-100 disabled:opacity-40 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800"
                :disabled="!activeSession"
                @click="saveSessionMeta"
              >
                Save
              </button>
            </div>
            <textarea
              v-model="notesInput"
              rows="3"
              placeholder="Notes about this session..."
              class="w-full resize-none rounded-md border border-surface-200 bg-white px-3 py-2 text-sm text-surface-900 placeholder:text-surface-400 focus:border-terminal-400 focus:outline-none dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100"
            />
          </div>
        </div>
      </template>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
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
  status?: string;
  tags?: string[];
  notes?: string;
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
const statusFilter = ref<'all' | 'active' | 'complete' | 'archived'>('active');
const tagFilter = ref('');
const notesOnly = ref(false);
const tagInput = ref('');
const notesInput = ref('');
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let searchRequestId = 0;
const isSearching = ref(false);
const messageScrollRef = ref<HTMLElement | null>(null);

const totalProjectsCount = computed(() => filteredProjects.value.reduce((sum, item) => sum + item.count, 0));
const sessionKeyNavEnabled = computed(() => listMode.value === 'sessions');

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

function applyFilters() {
  const search = searchTerm.value.trim().toLowerCase();
  const project = selectedProject.value;
  const tagTerm = tagFilter.value.trim().toLowerCase();
  filteredSessions.value = sessions.value.filter((session) => {
    if (project && (session.project || session.cwd || 'Unknown') !== project) return false;
    if (statusFilter.value === 'active' && session.status !== 'active') return false;
    if (statusFilter.value === 'complete' && session.status !== 'complete') return false;
    if (statusFilter.value === 'archived' && session.status !== 'archived') return false;
    if (notesOnly.value) {
      const notes = typeof session.notes === 'string' ? session.notes.trim() : '';
      if (!notes) return false;
    }
    if (tagTerm) {
      const tags = Array.isArray(session.tags) ? session.tags : [];
      const match = tags.some((tag) => tag.toLowerCase().includes(tagTerm));
      if (!match) return false;
    }
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
  const requestId = ++searchRequestId;
  isSearching.value = true;
  const params = new URLSearchParams({ source: activeSource.value, query });
  if (selectedProject.value) params.set('project', selectedProject.value);
  try {
    const response = await fetch(`/api/search?${params.toString()}`);
    const data = await response.json();
    if (requestId !== searchRequestId) return;
    sessions.value = data.sessions || [];
    applyFilters();
  } finally {
    if (requestId === searchRequestId) {
      isSearching.value = false;
    }
  }
}

async function selectSession(session: Session) {
  activeSession.value = session;
  sessionName.value = session.name || '';
  tagInput.value = (session.tags || []).join(', ');
  notesInput.value = session.notes || '';
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
  const nextArchive = activeSession.value.status !== 'archived';
  if (nextArchive) {
    const targetRelPath = activeSession.value.relPath;
    sessions.value = sessions.value.map((session) =>
      session.relPath === targetRelPath ? { ...session, status: 'archived' } : session
    );
    applyFilters();
  }
  await fetch('/api/archive-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: activeSource.value,
      relPath: activeSession.value.relPath,
      archive: nextArchive
    })
  });
  activeSession.value = null;
  activeSessionDetail.value = null;
  await fetchSessions();
  await fetchProjects();
}

async function toggleCompleteSession() {
  if (!activeSession.value) return;
  const nextComplete = activeSession.value.status !== 'complete';
  await fetch('/api/complete-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: activeSource.value,
      relPath: activeSession.value.relPath,
      complete: nextComplete
    })
  });
  await fetchSessions();
  const updated = sessions.value.find((session) => session.relPath === activeSession.value?.relPath);
  if (updated) {
    activeSession.value = updated;
  }
  applyFilters();
}

async function saveSessionMeta() {
  if (!activeSession.value) return;
  const tags = tagInput.value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  await fetch('/api/session-meta', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: activeSource.value,
      relPath: activeSession.value.relPath,
      tags,
      notes: notesInput.value
    })
  });
  await fetchSessions();
  const updated = sessions.value.find((session) => session.relPath === activeSession.value?.relPath);
  if (updated) {
    activeSession.value = updated;
    tagInput.value = (updated.tags || []).join(', ');
    notesInput.value = updated.notes || '';
  }
  applyFilters();
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

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || target.isContentEditable;
}

function handleSessionKeyNav(event: KeyboardEvent) {
  console.log('[sessions] keynav', {
    key: event.key,
    listMode: listMode.value,
    target: (event.target as HTMLElement | null)?.tagName
  });
  if (!sessionKeyNavEnabled.value) return;
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  if (isEditableTarget(event.target)) return;
  if (!filteredSessions.value.length) return;

  event.preventDefault();
  const currentIndex = activeSession.value
    ? filteredSessions.value.findIndex((session) => session.relPath === activeSession.value?.relPath)
    : -1;
  const delta = event.key === 'ArrowDown' ? 1 : -1;
  let nextIndex = currentIndex + delta;
  if (nextIndex < 0) nextIndex = 0;
  if (nextIndex >= filteredSessions.value.length) nextIndex = filteredSessions.value.length - 1;
  const nextSession = filteredSessions.value[nextIndex];
  if (nextSession) {
    selectSession(nextSession);
  }
}

watch(projectSearch, (value) => {
  const term = value.trim().toLowerCase();
  if (!term) {
    filteredProjects.value = projects.value;
    return;
  }
  filteredProjects.value = projects.value.filter((project) => project.path.toLowerCase().includes(term));
});

watch(statusFilter, () => {
  applyFilters();
});

watch(tagFilter, () => {
  applyFilters();
});

watch(notesOnly, () => {
  applyFilters();
});

watch(searchTerm, (value) => {
  if (searchTimer) clearTimeout(searchTimer);
  const query = value.trim();
  if (!query) {
    isSearching.value = false;
    fetchSessions();
    return;
  }
  isSearching.value = true;
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
  statusFilter.value = 'active';
  tagFilter.value = '';
  notesOnly.value = false;
  tagInput.value = '';
  notesInput.value = '';
  isSearching.value = false;
  fetchSessions();
  fetchProjects();
});

watch(activeSessionDetail, async (value) => {
  if (!value) return;
  await nextTick();
  const el = messageScrollRef.value;
  if (!el) return;
  el.focus();
  requestAnimationFrame(() => {
    el.scrollTop = el.scrollHeight;
  });
});

onMounted(async () => {
  await fetchSessions();
  await fetchProjects();
  window.addEventListener('keydown', handleSessionKeyNav);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleSessionKeyNav);
});
</script>
