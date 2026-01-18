const state = {
  sessions: [],
  filtered: [],
  active: null,
};

const searchInput = document.getElementById('searchInput');
const projectList = document.getElementById('projectList');
const projectSearchInput = document.getElementById('projectSearchInput');
const sessionList = document.getElementById('sessionList');
const sessionDetail = document.getElementById('sessionDetail');
const projectView = document.getElementById('projectView');
const sessionView = document.getElementById('sessionView');
const backToProjects = document.getElementById('backToProjects');
const sessionProjectLabel = document.getElementById('sessionProjectLabel');
const countLabel = document.getElementById('countLabel');
const reloadButton = document.getElementById('reloadButton');
const tabMessages = document.getElementById('tabMessages');
const tabRaw = document.getElementById('tabRaw');
const rejoinButton = document.getElementById('rejoinButton');
const focusButton = document.getElementById('focusButton');
const sourceCodex = document.getElementById('sourceCodex');
const sourceClaude = document.getElementById('sourceClaude');
const sessionNameInput = document.getElementById('sessionNameInput');
const saveNameButton = document.getElementById('saveNameButton');
const newSessionButton = document.getElementById('newSessionButton');

let activeTab = 'messages';
let activeSessionData = null;
let activeSource = 'codex';
let selectedProject = '';
let projectIndex = [];
let filteredProjectIndex = [];
let listMode = 'projects';

function showProjectView() {
  listMode = 'projects';
  projectView.classList.remove('is-hidden');
  sessionView.classList.add('is-hidden');
}

function showSessionView() {
  listMode = 'sessions';
  projectView.classList.add('is-hidden');
  sessionView.classList.remove('is-hidden');
}

function formatTimestamp(value) {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function setActiveSession(session) {
  state.active = session;
  activeSessionData = null;
  sessionNameInput.value = session.name || '';
  saveNameButton.disabled = false;
  renderList();
  renderDetail();
}

function getProjectKey(session) {
  return session.project || session.cwd || 'Unknown';
}

function renderProjects() {
  projectList.innerHTML = '';
  const filtered = filteredProjectIndex.length ? filteredProjectIndex : projectIndex;
  const totalCount = filtered.reduce((sum, p) => sum + p.count, 0);
  const allButton = document.createElement('button');
  allButton.type = 'button';
  allButton.className = 'project-item';
  if (!selectedProject) allButton.classList.add('active');
  allButton.textContent = `All sessions (${totalCount})`;
  allButton.addEventListener('click', () => {
    selectedProject = '';
    applyFilters();
    renderProjects();
    showSessionView();
  });
  projectList.appendChild(allButton);

  filtered.forEach((project) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'project-item';
    if (selectedProject === project.path) {
      item.classList.add('active');
    }
    item.textContent = `${project.path} (${project.count})`;
    item.addEventListener('click', () => {
      selectedProject = project.path;
      applyFilters();
      renderProjects();
      showSessionView();
    });
    projectList.appendChild(item);
  });

  const canStart = selectedProject && selectedProject.startsWith('/');
  newSessionButton.disabled = !canStart;
  newSessionButton.textContent =
    activeSource === 'claude' ? 'New Claude Session' : 'New Codex Session';
}

function applyFilters() {
  const search = searchInput.value.trim().toLowerCase();
  const project = selectedProject;

  state.filtered = state.sessions.filter((session) => {
    if (project && getProjectKey(session) !== project) return false;
    if (!search) return true;
    const haystack = [session.name, session.fileName, session.project, session.cwd, session.id, session.relPath]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(search);
  });

  if (state.active && !state.filtered.find((session) => session.relPath === state.active.relPath)) {
    state.active = null;
    renderDetail();
  }

  renderList();
}

function renderList() {
  sessionList.innerHTML = '';
  countLabel.textContent = `${state.filtered.length} session${state.filtered.length === 1 ? '' : 's'}`;
  sessionProjectLabel.textContent = selectedProject ? selectedProject : 'All sessions';

  state.filtered.forEach((session) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'session-item';
    if (state.active && session.relPath === state.active.relPath) {
      item.classList.add('active');
    }

    const title = session.name ? `${session.name} · ${session.fileName}` : session.fileName;
    item.innerHTML = `
      <div class="session-title">${title}</div>
      <div class="session-meta">
        <span>${formatTimestamp(session.timestamp)}</span>
        <span>${session.project || session.cwd || 'Unknown project'}</span>
      </div>
    `;

    item.addEventListener('click', () => setActiveSession(session));
    sessionList.appendChild(item);
  });

  if (!state.filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No sessions match your filters.';
    sessionList.appendChild(empty);
  }
}

async function fetchSessions() {
  const endpoint = activeSource === 'claude' ? '/api/claude/sessions' : '/api/sessions';
  const response = await fetch(endpoint);
  const data = await response.json();
  state.sessions = data.sessions || [];
  state.filtered = state.sessions;
  applyFilters();
}

async function fetchProjects() {
  const endpoint = `/api/projects?source=${encodeURIComponent(activeSource)}`;
  const response = await fetch(endpoint);
  const data = await response.json();
  projectIndex = Array.isArray(data.projects) ? data.projects : [];
  filteredProjectIndex = [];
  if (selectedProject && !projectIndex.find((p) => p.path === selectedProject)) {
    selectedProject = '';
  }
  renderProjects();
}

async function renderDetail() {
  if (!state.active) {
    sessionDetail.innerHTML = '<p class="muted">Select a session to view its raw JSONL content.</p>';
    rejoinButton.disabled = true;
    focusButton.disabled = true;
    saveNameButton.disabled = true;
    sessionNameInput.value = '';
    return;
  }

  rejoinButton.disabled = activeSource !== 'codex' || !state.active.id;
  focusButton.disabled = activeSource !== 'codex' || !state.active.id;
  sessionDetail.innerHTML = '<p class="muted">Loading session...</p>';
  const endpoint = activeSource === 'claude' ? '/api/claude/session' : '/api/session';
  const response = await fetch(`${endpoint}?file=${encodeURIComponent(state.active.relPath)}`);
  if (!response.ok) {
    sessionDetail.innerHTML = '<p class="muted">Unable to load session content.</p>';
    return;
  }

  const data = await response.json();
  activeSessionData = data;
  const meta = data.meta || {};
  sessionDetail.innerHTML = `
    <div class="detail-meta">
      <div>
        <div class="label">File</div>
        <div class="value">${data.relPath}</div>
      </div>
      <div>
        <div class="label">Project</div>
        <div class="value">${state.active.project || state.active.cwd || meta.cwd || 'Unknown'}</div>
      </div>
      <div>
        <div class="label">Timestamp</div>
        <div class="value">${formatTimestamp(state.active.timestamp)}</div>
      </div>
      <div>
        <div class="label">Session ID</div>
        <div class="value">${state.active.id || meta.sessionId || 'Unknown'}</div>
      </div>
    </div>
    ${renderDetailBody(data)}
  `;
}

function renderDetailBody(data) {
  if (activeTab === 'raw') {
    return `<pre>${escapeHtml(data.content)}</pre>`;
  }

  const messages = Array.isArray(data.messages) ? data.messages : [];
  if (!messages.length) {
    return '<p class="muted">No message items found in this session.</p>';
  }

  const rendered = messages
    .map((message) => {
      return `
        <article class="message-card ${message.role}">
          <header>
            <span class="role">${escapeHtml(message.role)}</span>
            <span class="timestamp">${escapeHtml(formatTimestamp(message.timestamp))}</span>
          </header>
          <pre>${escapeHtml(message.text)}</pre>
        </article>
      `;
    })
    .join('');

  return `<div class="message-list">${rendered}</div>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

searchInput.addEventListener('input', applyFilters);
projectSearchInput.addEventListener('input', () => {
  const term = projectSearchInput.value.trim().toLowerCase();
  if (!term) {
    filteredProjectIndex = [];
  } else {
    filteredProjectIndex = projectIndex.filter((project) =>
      project.path.toLowerCase().includes(term)
    );
  }
  if (
    selectedProject &&
    !filteredProjectIndex.find((project) => project.path === selectedProject)
  ) {
    selectedProject = '';
    applyFilters();
  }
  renderProjects();
});
backToProjects.addEventListener('click', showProjectView);
reloadButton.addEventListener('click', () => {
  fetchSessions();
  fetchProjects();
});
tabMessages.addEventListener('click', () => switchTab('messages'));
tabRaw.addEventListener('click', () => switchTab('raw'));
rejoinButton.addEventListener('click', async () => {
  if (!state.active || !state.active.id) return;
  rejoinButton.disabled = true;
  try {
    await fetch(`/api/resume?sessionId=${encodeURIComponent(state.active.id)}`);
  } catch (err) {
    // The server will handle errors; keep UI minimal.
  } finally {
    rejoinButton.disabled = false;
  }
});
focusButton.addEventListener('click', async () => {
  if (!state.active || !state.active.id) return;
  focusButton.disabled = true;
  try {
    await fetch(`/api/focus?sessionId=${encodeURIComponent(state.active.id)}`);
  } catch (err) {
    // The server will handle errors; keep UI minimal.
  } finally {
    focusButton.disabled = false;
  }
});
saveNameButton.addEventListener('click', async () => {
  if (!state.active) return;
  saveNameButton.disabled = true;
  try {
    await fetch('/api/name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: activeSource,
        relPath: state.active.relPath,
        name: sessionNameInput.value.trim(),
      }),
    });
    await fetchSessions();
    const updated = state.sessions.find((session) => session.relPath === state.active.relPath);
    if (updated) {
      state.active = updated;
      sessionNameInput.value = updated.name || '';
    }
    renderList();
  } catch (err) {
    // Keep UI minimal.
  } finally {
    saveNameButton.disabled = false;
  }
});
newSessionButton.addEventListener('click', async () => {
  if (!selectedProject) return;
  newSessionButton.disabled = true;
  try {
    const response = await fetch(
      `/api/new-session?source=${encodeURIComponent(activeSource)}&cwd=${encodeURIComponent(selectedProject)}`
    );
    if (!response.ok) {
      // noop
    }
  } catch (err) {
    // noop
  } finally {
    newSessionButton.disabled = false;
  }
});
sourceCodex.addEventListener('click', () => setSource('codex'));
sourceClaude.addEventListener('click', () => setSource('claude'));

function switchTab(tab) {
  activeTab = tab;
  tabMessages.classList.toggle('active', tab === 'messages');
  tabRaw.classList.toggle('active', tab === 'raw');
  if (state.active && activeSessionData) {
    const meta = activeSessionData.meta || {};
    sessionDetail.innerHTML = `
      <div class="detail-meta">
        <div>
          <div class="label">File</div>
          <div class="value">${activeSessionData.relPath}</div>
        </div>
        <div>
          <div class="label">Project</div>
          <div class="value">${state.active.project || state.active.cwd || meta.cwd || 'Unknown'}</div>
        </div>
        <div>
          <div class="label">Timestamp</div>
          <div class="value">${formatTimestamp(state.active.timestamp)}</div>
        </div>
        <div>
          <div class="label">Session ID</div>
          <div class="value">${state.active.id || meta.sessionId || 'Unknown'}</div>
        </div>
      </div>
      ${renderDetailBody(activeSessionData)}
    `;
  }
}

function setSource(source) {
  activeSource = source;
  sourceCodex.classList.toggle('active', source === 'codex');
  sourceClaude.classList.toggle('active', source === 'claude');
  state.active = null;
  activeSessionData = null;
  activeTab = 'messages';
  tabMessages.classList.add('active');
  tabRaw.classList.remove('active');
  rejoinButton.disabled = source !== 'codex';
  focusButton.disabled = source !== 'codex';
  saveNameButton.disabled = true;
  sessionNameInput.value = '';
  selectedProject = '';
  sessionDetail.innerHTML = '<p class="muted">Select a session to view its raw JSONL content.</p>';
  showProjectView();
  fetchSessions();
  fetchProjects();
}

fetchSessions().catch(() => {
  sessionDetail.innerHTML = '<p class="muted">Failed to load sessions. Is the server running?</p>';
});

fetchProjects().catch(() => {
  projectList.innerHTML = '<div class="empty">Failed to load projects.</div>';
});

showProjectView();
