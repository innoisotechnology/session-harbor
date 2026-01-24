<template>
  <main class="flex h-[calc(100vh-88px)] gap-px bg-surface-200 dark:bg-surface-800">
    <!-- Left Panel: Skills List -->
    <section class="flex w-80 flex-col bg-surface-50 dark:bg-surface-900">
      <div class="border-b border-surface-100 px-4 py-3 dark:border-surface-800">
        <div class="flex items-center justify-between">
          <span class="text-2xs font-medium uppercase tracking-wider text-surface-400">Skills</span>
          <span class="font-mono text-2xs text-surface-400">{{ filteredSkills.length }}</span>
        </div>
        <div v-if="baseDir" class="mt-1 truncate font-mono text-2xs text-surface-400" :title="baseDir">
          {{ baseDir }}
        </div>
      </div>

      <div class="flex items-center gap-2 border-b border-surface-200 px-3 py-2 dark:border-surface-800">
        <div class="relative flex-1">
          <svg class="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            v-model="searchTerm"
            type="text"
            placeholder="Filter skills..."
            class="w-full rounded-md border border-surface-200 bg-white py-1.5 pl-8 pr-3 text-sm text-surface-900 placeholder:text-surface-400 focus:border-terminal-400 focus:outline-none dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100"
          />
        </div>
        <button
          class="flex h-8 w-8 items-center justify-center rounded-md border border-surface-200 text-surface-500 transition-colors hover:bg-surface-100 hover:text-surface-700 dark:border-surface-700 dark:hover:bg-surface-800 dark:hover:text-surface-200"
          @click="refreshSkills"
          title="Reload"
        >
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>
      </div>

      <div class="flex-1 overflow-y-auto scrollbar-thin p-2">
        <div v-if="missingDir" class="flex flex-col items-center justify-center py-12 text-center text-surface-400">
          <svg class="h-8 w-8 text-surface-300 dark:text-surface-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path d="M3 7h6l2 2h10v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
          </svg>
          <p class="mt-2 text-xs">No skills directory found</p>
          <p class="mt-1 font-mono text-2xs text-surface-400">Create {{ activeSource }} skills to populate this list.</p>
        </div>

        <div v-else-if="filteredSkills.length === 0" class="flex flex-col items-center justify-center py-12 text-center text-surface-400">
          <svg class="h-8 w-8 text-surface-300 dark:text-surface-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z"/>
          </svg>
          <p class="mt-2 text-xs">No skills match</p>
          <p class="mt-1 font-mono text-2xs text-surface-400">Try a different filter.</p>
        </div>

        <div class="space-y-1">
          <button
            v-for="skill in filteredSkills"
            :key="skill.relPath"
            class="w-full rounded-md p-2.5 text-left transition-colors"
            :class="activeSkill?.relPath === skill.relPath
              ? 'bg-terminal-500/10 ring-1 ring-terminal-500/30'
              : 'hover:bg-surface-100 dark:hover:bg-surface-800'"
            @click="selectSkill(skill)"
          >
            <div class="flex items-start justify-between gap-2">
              <span class="text-sm font-medium text-surface-800 dark:text-surface-100">{{ skill.name }}</span>
              <span v-if="skill.updatedAt" class="shrink-0 font-mono text-2xs text-surface-400">{{ formatTimestamp(skill.updatedAt) }}</span>
            </div>
            <p class="mt-1 max-h-8 overflow-hidden text-2xs text-surface-500 dark:text-surface-400">
              {{ skill.description || 'No description yet.' }}
            </p>
            <p class="mt-1 truncate font-mono text-2xs text-surface-400" :title="skill.relPath">
              {{ shortenPath(skill.relPath) }}
            </p>
          </button>
        </div>
      </div>
    </section>

    <!-- Right Panel: Skill Detail -->
    <section class="flex min-w-0 flex-1 flex-col bg-surface-50 dark:bg-surface-900">
      <div v-if="!activeSkill" class="flex flex-1 flex-col items-center justify-center text-surface-400">
        <svg class="h-12 w-12 text-surface-200 dark:text-surface-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
          <path d="M4 6h16M4 12h16M4 18h16"/>
        </svg>
        <p class="mt-3 text-sm">Select a skill to view details</p>
      </div>

      <template v-else>
        <div class="border-b border-surface-200 px-4 py-3 dark:border-surface-800">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <h2 class="truncate text-base font-semibold text-surface-900 dark:text-surface-100">{{ activeSkill.name }}</h2>
              <p class="mt-0.5 truncate font-mono text-2xs text-surface-400" :title="activeSkill.relPath">{{ activeSkill.relPath }}</p>
            </div>
            <span class="rounded-full bg-surface-100 px-2 py-0.5 text-2xs text-surface-500 dark:bg-surface-800 dark:text-surface-300">
              {{ activeSource }}
            </span>
          </div>
          <p class="mt-2 text-xs text-surface-500 dark:text-surface-400">
            {{ activeSkill.description || 'No description captured yet.' }}
          </p>
        </div>

        <div class="grid grid-cols-3 gap-px border-b border-surface-200 bg-surface-200 dark:border-surface-800 dark:bg-surface-800">
          <div class="bg-surface-50 px-3 py-2 dark:bg-surface-900">
            <p class="text-2xs font-medium uppercase tracking-wider text-surface-400">Updated</p>
            <p class="mt-0.5 font-mono text-xs text-surface-700 dark:text-surface-200">{{ formatTimestamp(activeSkill.updatedAt) }}</p>
          </div>
          <div class="bg-surface-50 px-3 py-2 dark:bg-surface-900">
            <p class="text-2xs font-medium uppercase tracking-wider text-surface-400">Front matter</p>
            <p class="mt-0.5 font-mono text-xs text-surface-700 dark:text-surface-200">{{ activeSkill.hasFrontMatter ? 'Yes' : 'No' }}</p>
          </div>
          <div class="bg-surface-50 px-3 py-2 dark:bg-surface-900">
            <p class="text-2xs font-medium uppercase tracking-wider text-surface-400">Folder</p>
            <p class="mt-0.5 truncate font-mono text-xs text-surface-700 dark:text-surface-200" :title="baseDir">
              {{ shortenPath(baseDir) }}
            </p>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto scrollbar-thin p-4">
          <div v-if="activeDetail?.content" class="space-y-4">
            <div>
              <div class="mb-2 text-2xs font-medium uppercase tracking-wider text-surface-400">Skill file</div>
              <pre class="overflow-x-auto rounded-lg bg-surface-900 p-4 font-mono text-xs leading-relaxed text-surface-100">{{ activeDetail.content }}</pre>
            </div>
          </div>
          <div v-else class="flex h-full flex-col items-center justify-center text-surface-400">
            <svg class="h-8 w-8 text-surface-300 dark:text-surface-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z"/>
            </svg>
            <p class="mt-2 text-xs">Loading skill content...</p>
          </div>
        </div>
      </template>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useSourceStore } from '../store/source';

type SkillSummary = {
  name: string;
  description: string;
  relPath: string;
  updatedAt?: string;
  hasFrontMatter: boolean;
};

type SkillDetail = SkillSummary & {
  content: string;
  baseDir: string;
};

const { activeSource } = useSourceStore();
const skills = ref<SkillSummary[]>([]);
const activeSkill = ref<SkillSummary | null>(null);
const activeDetail = ref<SkillDetail | null>(null);
const searchTerm = ref('');
const baseDir = ref('');
const missingDir = ref(false);

const filteredSkills = computed(() => {
  const term = searchTerm.value.trim().toLowerCase();
  if (!term) return skills.value;
  return skills.value.filter((skill) => {
    const haystack = [skill.name, skill.description, skill.relPath].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(term);
  });
});

function formatTimestamp(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function shortenPath(pathValue: string) {
  if (!pathValue) return '';
  const parts = pathValue.split('/');
  if (parts.length <= 3) return pathValue;
  return '.../' + parts.slice(-2).join('/');
}

async function fetchSkills() {
  activeSkill.value = null;
  activeDetail.value = null;
  const response = await fetch(`/api/skills?source=${encodeURIComponent(activeSource.value)}`);
  const data = await response.json();
  skills.value = Array.isArray(data.skills) ? data.skills : [];
  baseDir.value = data.baseDir || '';
  missingDir.value = Boolean(data.missing);
}

async function selectSkill(skill: SkillSummary) {
  activeSkill.value = skill;
  activeDetail.value = null;
  const response = await fetch(`/api/skill?source=${encodeURIComponent(activeSource.value)}&path=${encodeURIComponent(skill.relPath)}`);
  const data = await response.json();
  activeDetail.value = data.skill || null;
}

function refreshSkills() {
  fetchSkills();
}

watch(activeSource, () => {
  searchTerm.value = '';
  fetchSkills();
});

watch(filteredSkills, (value) => {
  if (!activeSkill.value) return;
  const stillExists = value.some((skill) => skill.relPath === activeSkill.value?.relPath);
  if (!stillExists) {
    activeSkill.value = null;
    activeDetail.value = null;
  }
});

onMounted(() => {
  fetchSkills();
});
</script>
