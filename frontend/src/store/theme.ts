import { ref } from 'vue';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'session-harbor-theme';
const themePreference = ref<ThemePreference>(loadPreference());

function loadPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

function resolveTheme(preference: ThemePreference) {
  if (preference !== 'system') return preference;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyThemeClass(preference: ThemePreference) {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(preference);
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

function setPreference(preference: ThemePreference) {
  themePreference.value = preference;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, preference);
  }
  applyThemeClass(preference);
}

function initThemeListener() {
  if (typeof window === 'undefined') return;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => applyThemeClass(themePreference.value);
  media.addEventListener('change', handler);
  return () => media.removeEventListener('change', handler);
}

export function useThemeStore() {
  return {
    themePreference,
    setPreference,
    applyThemeClass,
    initThemeListener
  };
}
