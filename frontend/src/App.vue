<template>
  <div class="min-h-screen bg-surface-50 text-surface-900 dark:bg-surface-950 dark:text-surface-100 bg-grid">
    <!-- Top bar -->
    <header class="sticky top-0 z-50 border-b border-surface-200/80 bg-surface-50/95 backdrop-blur-sm dark:border-surface-800/80 dark:bg-surface-950/95">
      <div class="flex items-center justify-between px-6 py-3">
        <!-- Logo & Title -->
        <div class="flex items-center gap-4">
          <div class="relative flex h-9 w-9 items-center justify-center">
            <img
              src="./assets/app-icon.png"
              alt="Session Harbor"
              class="h-9 w-9 rounded-lg object-cover"
            />
          </div>
          <div class="flex items-baseline gap-3">
            <h1 class="text-lg font-semibold tracking-tight">Session Harbor</h1>
            <span class="hidden text-xs text-surface-400 sm:inline">Codex / Claude / Copilot</span>
          </div>
        </div>

        <!-- Controls -->
        <div class="flex items-center gap-2">
          <!-- Source Selector -->
          <div class="flex rounded-lg border border-surface-200 bg-surface-100 p-0.5 dark:border-surface-700 dark:bg-surface-800">
            <button
              v-for="source in sources"
              :key="source.id"
              class="relative rounded-md px-3 py-1.5 text-xs font-medium transition-all"
              :class="activeSource === source.id
                ? 'bg-white text-surface-900 shadow-sm dark:bg-surface-700 dark:text-surface-100'
                : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200'"
              @click="setSource(source.id)"
            >
              <span class="relative z-10">{{ source.label }}</span>
            </button>
          </div>

          <!-- Divider -->
          <div class="mx-1 h-6 w-px bg-surface-200 dark:bg-surface-700"></div>

          <!-- Theme Toggle -->
          <button
            class="flex h-8 w-8 items-center justify-center rounded-lg text-surface-500 transition-colors hover:bg-surface-100 hover:text-surface-700 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-surface-200"
            @click="cycleTheme"
            :title="`Theme: ${themePreference}`"
          >
            <svg v-if="themePreference === 'light'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
            </svg>
            <svg v-else-if="themePreference === 'dark'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
            <svg v-else class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Navigation -->
      <nav class="flex gap-1 px-6 pb-2">
        <RouterLink
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="relative px-3 py-1.5 text-sm font-medium transition-colors"
          :class="isActive(item.path)
            ? 'text-surface-900 dark:text-surface-100'
            : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200'"
        >
          {{ item.label }}
          <span
            v-if="isActive(item.path)"
            class="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-terminal-500"
          ></span>
        </RouterLink>
      </nav>
    </header>

    <!-- Page Content -->
    <RouterView />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { useThemeStore } from './store/theme';
import { useSourceStore } from './store/source';

const route = useRoute();
const { activeSource, setSource } = useSourceStore();
const {
  themePreference,
  setPreference,
  applyThemeClass,
  initThemeListener
} = useThemeStore();

const sources = [
  { id: 'codex', label: 'Codex' },
  { id: 'claude', label: 'Claude' },
  { id: 'copilot', label: 'Copilot' }
] as const;

const navItems = [
  { path: '/sessions', label: 'Sessions' },
  { path: '/notes', label: 'Notes' },
  { path: '/skills', label: 'Skills' },
  { path: '/status', label: 'Status' },
  { path: '/reports', label: 'Reports' },
  { path: '/feedback', label: 'Feedback' }
];

let removeThemeListener: (() => void) | undefined;

function cycleTheme() {
  const themes: ('system' | 'light' | 'dark')[] = ['system', 'light', 'dark'];
  const current = themes.indexOf(themePreference.value as 'system' | 'light' | 'dark');
  const next = themes[(current + 1) % themes.length];
  setPreference(next);
}

function isActive(path: string) {
  return route.path === path;
}

onMounted(() => {
  applyThemeClass(themePreference.value);
  removeThemeListener = initThemeListener();
});

onUnmounted(() => {
  if (removeThemeListener) removeThemeListener();
});
</script>
