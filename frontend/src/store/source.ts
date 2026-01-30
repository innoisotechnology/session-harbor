import { ref } from 'vue';

export type SessionSource = 'codex' | 'claude' | 'copilot' | 'openclaw';

const STORAGE_KEY = 'session-harbor-source';
const activeSource = ref<SessionSource>(loadSource());

function loadSource(): SessionSource {
  if (typeof window === 'undefined') return 'codex';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'codex' || stored === 'claude' || stored === 'copilot' || stored === 'openclaw') return stored;
  return 'codex';
}

function setSource(source: SessionSource) {
  activeSource.value = source;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, source);
  }
}

export function useSourceStore() {
  return {
    activeSource,
    setSource
  };
}
