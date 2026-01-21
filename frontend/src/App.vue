<template>
  <div class="min-h-screen bg-mist text-ink dark:bg-slate-950 dark:text-slate-100">
    <header class="flex flex-wrap items-center justify-between gap-6 px-8 py-6">
      <div class="flex items-center gap-4">
        <div class="relative grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-accent to-sky-400 shadow-[0_14px_30px_rgba(37,99,235,0.35)]">
          <div class="absolute h-7 w-7 rounded-full border border-white/70"></div>
          <div class="h-3 w-3 rounded-full bg-cyan-200 shadow-[0_0_14px_rgba(94,242,255,0.9)]"></div>
        </div>
        <div>
          <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Session Harbor</p>
          <h1 class="text-2xl font-semibold">Dock, scan, and relaunch your AI sessions.</h1>
          <p class="text-sm text-slate-500 dark:text-slate-400">A local harbor for Codex, Claude, and Copilot session logs.</p>
        </div>
      </div>

      <div class="flex flex-wrap items-end gap-3">
        <label class="flex flex-col text-sm text-slate-500 dark:text-slate-400">
          <span>Theme</span>
          <select
            v-model="themePreference"
            class="mt-1 w-36 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-inner dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            @change="setThemePreference(themePreference)"
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <div class="flex rounded-full border border-slate-200 bg-white/60 p-1 shadow-inner dark:border-slate-700 dark:bg-slate-900/70">
          <button
            class="rounded-full px-4 py-1.5 text-sm"
            :class="activeSource === 'codex' ? 'bg-white text-slate-900 shadow dark:bg-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'"
            @click="setSource('codex')"
          >
            Codex
          </button>
          <button
            class="rounded-full px-4 py-1.5 text-sm"
            :class="activeSource === 'claude' ? 'bg-white text-slate-900 shadow dark:bg-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'"
            @click="setSource('claude')"
          >
            Claude
          </button>
          <button
            class="rounded-full px-4 py-1.5 text-sm"
            :class="activeSource === 'copilot' ? 'bg-white text-slate-900 shadow dark:bg-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'"
            @click="setSource('copilot')"
          >
            Copilot
          </button>
        </div>
      </div>
    </header>

    <nav class="flex flex-wrap gap-3 px-8 pb-4">
      <RouterLink
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:border-accent hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
        :class="isActive(item.path) ? 'border-accent bg-white text-slate-900 shadow dark:bg-slate-800 dark:text-slate-100' : ''"
      >
        {{ item.label }}
      </RouterLink>
    </nav>

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

const navItems = [
  { path: '/sessions', label: 'Sessions' },
  { path: '/status', label: 'Status' },
  { path: '/reports', label: 'Reports' },
  { path: '/feedback', label: 'Feedback' }
];

let removeThemeListener: (() => void) | undefined;

function setThemePreference(value: string) {
  setPreference(value as 'light' | 'dark' | 'system');
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
