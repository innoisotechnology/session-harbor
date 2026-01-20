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
const deleteSessionButton = document.getElementById('deleteSessionButton');
const statusButton = document.getElementById('statusButton');
const nameEditor = document.getElementById('nameEditor');

let activeTab = 'messages';
let activeSessionData = null;
let activeSource = 'codex';
let selectedProject = '';
let projectIndex = [];
let filteredProjectIndex = [];
let listMode = 'projects';
let detailMode = 'session';
let searchTimer = null;
let pendingSessionRelPath = '';

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  const source = params.get('source');
  const project = params.get('project');
  const session = params.get('session');
  return {
    source: source === 'codex' || source === 'claude' ? source : null,
    project: project || '',
    session: session || '',
  };
}

function syncUrlState() {
  const params = new URLSearchParams();
  params.set('source', activeSource);
  if (selectedProject) params.set('project', selectedProject);
  if (state.active?.relPath) params.set('session', state.active.relPath);
  const qs = params.toString();
  const nextUrl = qs ? `?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', nextUrl);
}

function applySourceUi(source) {
  sourceCodex.classList.toggle('active', source === 'codex');
  sourceClaude.classList.toggle('active', source === 'claude');
  rejoinButton.disabled = source !== 'codex';
  focusButton.disabled = source !== 'codex';
}

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
  detailMode = 'session';
  nameEditor.classList.remove('is-hidden');
  renderList();
  renderDetail();
  syncUrlState();
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
    syncUrlState();
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
      syncUrlState();
    });
    projectList.appendChild(item);
  });

  const canStart = selectedProject && selectedProject.startsWith('/');
  newSessionButton.disabled = !canStart;
  newSessionButton.textContent =
    activeSource === 'claude' ? 'New Claude Session' : 'New Codex Session';
}

function applyFilters() {
  const search = searchInput.value.trim();
  const project = selectedProject;

  state.filtered = state.sessions.filter((session) => {
    if (project && getProjectKey(session) !== project) return false;
    if (!search) return true;
    const haystack = [session.name, session.fileName, session.project, session.cwd, session.id, session.relPath]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(search.toLowerCase());
  });

  if (state.active && !state.filtered.find((session) => session.relPath === state.active.relPath)) {
    state.active = null;
    renderDetail();
  }

  renderList();
}

async function searchSessions(query) {
  const params = new URLSearchParams({
    source: activeSource,
    query
  });
  if (selectedProject) {
    params.set('project', selectedProject);
  }
  const response = await fetch(`/api/search?${params.toString()}`);
  const data = await response.json();
  state.sessions = data.sessions || [];
  state.filtered = state.sessions;
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

    const title = session.name || session.fileName;
    const messageLabel =
      typeof session.messageCount === 'number' ? `${session.messageCount} msgs` : '— msgs';
    const matchLabel =
      typeof session.matchCount === 'number' ? `${session.matchCount} hits` : null;
    item.innerHTML = `
      <div class="session-title">${title}</div>
      <div class="session-meta">
        <span>${formatTimestamp(session.timestamp)}</span>
        <span>${session.project || session.cwd || 'Unknown project'}</span>
        <span>${messageLabel}</span>
        ${matchLabel ? `<span>${matchLabel}</span>` : ''}
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

function clearSearch() {
  searchInput.value = '';
  if (searchTimer) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }
}

async function renderDetail() {
  if (!state.active) {
    sessionDetail.innerHTML = '<p class="muted">Select a session to view its raw JSONL content.</p>';
    rejoinButton.disabled = true;
    focusButton.disabled = true;
    saveNameButton.disabled = true;
    sessionNameInput.value = '';
    deleteSessionButton.disabled = true;
    if (detailMode === 'session') {
      nameEditor.classList.remove('is-hidden');
    }
    return;
  }

  rejoinButton.disabled = activeSource !== 'codex' || !state.active.id;
  focusButton.disabled = activeSource !== 'codex' || !state.active.id;
  deleteSessionButton.disabled = false;
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
    <div class="detail-body">
      ${renderDetailBody(data)}
    </div>
  `;
}

function renderDetailBody(data) {
  if (activeTab === 'raw') {
    return `<pre class="raw-content">${escapeHtml(data.content)}</pre>`;
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

searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim();
  if (searchTimer) {
    clearTimeout(searchTimer);
  }
  if (!query) {
    fetchSessions();
    return;
  }
  searchTimer = setTimeout(() => {
    searchSessions(query).catch(() => {
      sessionDetail.innerHTML = '<p class="muted">Search failed.</p>';
    });
  }, 250);
});
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
statusButton.addEventListener('click', async () => {
  detailMode = 'status';
  nameEditor.classList.add('is-hidden');
  sessionDetail.innerHTML = '<p class="muted">Loading status...</p>';
  try {
    const response = await fetch('/api/status');
    const data = await response.json();
    sessionDetail.innerHTML = renderStatusCard(data);
  } catch (err) {
    sessionDetail.innerHTML = '<p class="muted">Unable to load status.</p>';
  }
});
deleteSessionButton.addEventListener('click', async () => {
  if (!state.active) return;
  const label = state.active.name || state.active.fileName || 'this session';
  const confirmed = window.confirm(`Archive ${label}? This moves the session file to Archive.`);
  if (!confirmed) return;
  deleteSessionButton.disabled = true;
  try {
    await fetch('/api/archive-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: activeSource,
        relPath: state.active.relPath,
      }),
    });
    state.active = null;
    activeSessionData = null;
    renderDetail();
    await fetchSessions();
    syncUrlState();
  } catch (err) {
    // noop
  } finally {
    deleteSessionButton.disabled = false;
  }
});
newSessionButton.addEventListener('click', async () => {
  if (!selectedProject) return;
  const label = `Session name (optional)`;
  const name = window.prompt(label, '');
  if (name === null) return;
  newSessionButton.disabled = true;
  try {
    const response = await fetch(
      `/api/new-session?source=${encodeURIComponent(activeSource)}&cwd=${encodeURIComponent(selectedProject)}&name=${encodeURIComponent(name.trim())}`
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
      <div class="detail-body">
        ${renderDetailBody(activeSessionData)}
      </div>
    `;
  }
}

function setSource(source) {
  activeSource = source;
  applySourceUi(source);
  state.active = null;
  activeSessionData = null;
  activeTab = 'messages';
  tabMessages.classList.add('active');
  tabRaw.classList.remove('active');
  saveNameButton.disabled = true;
  sessionNameInput.value = '';
  deleteSessionButton.disabled = true;
  detailMode = 'session';
  nameEditor.classList.remove('is-hidden');
  selectedProject = '';
  sessionDetail.innerHTML = '<p class="muted">Select a session to view its raw JSONL content.</p>';
  showProjectView();
  clearSearch();
  fetchSessions();
  fetchProjects();
  syncUrlState();
}

async function init() {
  const urlState = readUrlState();
  if (urlState.source) activeSource = urlState.source;
  if (urlState.project) selectedProject = urlState.project;
  if (urlState.session) pendingSessionRelPath = urlState.session;

  applySourceUi(activeSource);
  showProjectView();

  try {
    await fetchSessions();
  } catch (err) {
    sessionDetail.innerHTML = '<p class="muted">Failed to load sessions. Is the server running?</p>';
  }

  try {
    await fetchProjects();
  } catch (err) {
    projectList.innerHTML = '<div class="empty">Failed to load projects.</div>';
  }

  if (selectedProject || pendingSessionRelPath) {
    showSessionView();
  }

  if (pendingSessionRelPath) {
    const match = state.sessions.find((session) => session.relPath === pendingSessionRelPath);
    if (match) {
      if (!selectedProject) {
        selectedProject = getProjectKey(match);
        applyFilters();
      }
      setActiveSession(match);
    }
    pendingSessionRelPath = '';
  }

  syncUrlState();
}

init();

function renderStatusCard(data) {
  const account = data.account || {};
  const rate = data.rateLimits || {};
  const primary = rate.primary || {};
  const secondary = rate.secondary || {};
  const credits = rate.credits || {};

  const primaryLeft = typeof primary.used_percent === 'number' ? 100 - primary.used_percent : null;
  const secondaryLeft = typeof secondary.used_percent === 'number' ? 100 - secondary.used_percent : null;

  return `
    <div class="status-card">
      <div class="status-header">
        <div class="status-title">Codex Status</div>
        <div class="count">${data.cliVersion || 'CLI unknown'}</div>
      </div>
      <div class="status-grid">
        <div class="status-block">
          <h3>Model</h3>
          <p>${data.model || 'Unknown'}</p>
        </div>
        <div class="status-block">
          <h3>Directory</h3>
          <p>${data.cwd || 'Unknown'}</p>
        </div>
        <div class="status-block">
          <h3>Approval</h3>
          <p>${data.approval || 'Unknown'}</p>
        </div>
        <div class="status-block">
          <h3>Sandbox</h3>
          <p>${data.sandbox || 'Unknown'}</p>
        </div>
        <div class="status-block">
          <h3>Account</h3>
          <p>${account.email || 'Unknown'}</p>
          <p class="muted">${account.plan || 'Plan unknown'}</p>
        </div>
        <div class="status-block">
          <h3>Session</h3>
          <p>${data.sessionId || 'Unknown'}</p>
        </div>
      </div>
      <div class="status-block">
        <h3>Limits</h3>
        ${renderLimitRow('5h limit', primaryLeft, primary.resets_at)}
        ${renderLimitRow('Weekly limit', secondaryLeft, secondary.resets_at)}
        ${credits.has_credits ? `<div class="limit-row"><span>Credits</span><span>${credits.unlimited ? 'Unlimited' : credits.balance || '—'}</span></div>` : ''}
      </div>
    </div>
  `;
}

function renderLimitRow(label, leftPercent, resetsAt) {
  if (leftPercent === null) {
    return `<div class="limit-row"><span>${label}</span><span>Unavailable</span></div>`;
  }
  const clamped = Math.max(0, Math.min(100, leftPercent));
  return `
    <div class="limit-row">
      <span>${label}</span>
      <span>${clamped.toFixed(0)}% left ${resetsAt ? `(resets ${resetsAt})` : ''}</span>
      <div class="limit-bar"><span style="width:${clamped}%;"></span></div>
    </div>
  `;
}
