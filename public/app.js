const columns = [
  { id: "running", title: "Running", description: "Open turns still producing work" },
  { id: "complete", title: "Complete", description: "Finished in the last 10 minutes" },
  { id: "recent", title: "Recent", description: "Finished in the last 2 hours" },
  { id: "today", title: "Today", description: "Finished today, older than 2 hours" },
  { id: "done", title: "Done", description: "Finished before today" },
];

const state = {
  threads: [],
  summary: null,
  query: "",
  activeStatuses: new Set(columns.map((column) => column.id)),
  quickFilter: "all",
  sortMode: "priority",
  hideDone: false,
  focusMode: false,
  lastSnapshotAt: null,
};

const board = document.querySelector("#board");
const spotlight = document.querySelector("#spotlight");
const columnTemplate = document.querySelector("#columnTemplate");
const cardTemplate = document.querySelector("#cardTemplate");
const search = document.querySelector("#search");
const refresh = document.querySelector("#refresh");
const focusMode = document.querySelector("#focusMode");
const hideDone = document.querySelector("#hideDone");
const statusFilters = document.querySelector("#statusFilters");
const quickFilters = document.querySelector("#quickFilters");
const sortMode = document.querySelector("#sortMode");

const quickFilterDefs = [
  { id: "all", label: "All" },
  { id: "review", label: "Needs review" },
  { id: "risk", label: "Risk" },
  { id: "unread", label: "Unread" },
  { id: "projectless", label: "Projectless" },
  { id: "subagents", label: "Subagents" },
];

function normalize(value) {
  return String(value || "").toLowerCase();
}

function formatRelative(value) {
  if (!value) return "No activity";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid timestamp";

  const diff = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.max(1, Math.round(diff / minute))}m ago`;
  if (diff < day) return `${Math.round(diff / hour)}h ago`;
  return `${Math.round(diff / day)}d ago`;
}

function formatClock(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function compactPath(value) {
  if (!value) return "";
  const parts = String(value).split(/[\\/]/).filter(Boolean);
  if (parts.length <= 3) return value;
  return `${parts.at(-3)} / ${parts.at(-2)} / ${parts.at(-1)}`;
}

function getParentThread(thread) {
  if (!thread.parentThreadId) return null;
  return state.threads.find((candidate) => candidate.id === thread.parentThreadId) || null;
}

function getDisplayTitle(thread) {
  if (thread.threadSource !== "subagent") return thread.name;
  return getParentThread(thread)?.name || "Subagent";
}

function getDisplaySubtitle(thread) {
  if (thread.threadSource !== "subagent") return `ID: ${thread.id}`;
  const agent = thread.agentNickname || "Subagent";
  const role = thread.agentRole ? ` / ${thread.agentRole}` : "";
  return `${agent}${role} · ID: ${thread.id}`;
}

function getPromptText(thread) {
  if (thread.threadSource !== "subagent") return thread.preview || thread.lastPrompt || thread.id;
  const task = thread.preview || thread.lastPrompt || thread.name;
  return `Delegated task: ${task}`;
}

function threadMatches(thread, query) {
  if (!query) return true;
  const parent = getParentThread(thread);
  const haystack = [
    thread.name,
    parent?.name,
    thread.agentNickname,
    thread.agentRole,
    thread.id,
    thread.lastPrompt,
    thread.preview,
    thread.permissionMode,
    thread.approvalPolicy,
    thread.workspace,
    thread.outputDirectory,
    thread.status,
    thread.lastToolName,
  ].map(normalize).join(" ");
  return haystack.includes(query);
}

function makeBadge(label, tone = "") {
  const badge = document.createElement("span");
  badge.className = tone ? `badge ${tone}` : "badge";
  badge.textContent = label;
  return badge;
}

function makeMeta(label, value) {
  const item = document.createElement("div");
  item.className = "meta-item";
  const key = document.createElement("span");
  key.textContent = label;
  const val = document.createElement("strong");
  val.textContent = value || "-";
  item.append(key, val);
  return item;
}

function renderStatusFilters() {
  statusFilters.replaceChildren();
  for (const column of columns) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.status = column.id;
    button.textContent = column.title;
    button.setAttribute("aria-pressed", String(state.activeStatuses.has(column.id)));
    button.addEventListener("click", () => {
      if (state.activeStatuses.has(column.id)) {
        state.activeStatuses.delete(column.id);
      } else {
        state.activeStatuses.add(column.id);
      }
      if (state.activeStatuses.size === 0) {
        state.activeStatuses = new Set(columns.map((item) => item.id));
      }
      render();
    });
    statusFilters.append(button);
  }
}

function renderQuickFilters() {
  quickFilters.replaceChildren();
  for (const filter of quickFilterDefs) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = filter.label;
    button.setAttribute("aria-pressed", String(state.quickFilter === filter.id));
    button.addEventListener("click", () => {
      state.quickFilter = filter.id;
      render();
    });
    quickFilters.append(button);
  }
}

function renderCard(thread) {
  const card = cardTemplate.content.firstElementChild.cloneNode(true);
  card.dataset.status = thread.status;
  card.classList.toggle("is-unread", thread.unread);
  card.classList.toggle("is-stale", thread.runningStale);
  card.classList.toggle("is-subagent", thread.threadSource === "subagent");
  const title = card.querySelector("h3");
  const id = card.querySelector(".thread-id");
  const prompt = card.querySelector(".prompt");
  title.textContent = getDisplayTitle(thread);
  title.title = thread.threadSource === "subagent" ? `Parent: ${getDisplayTitle(thread)}\nSubagent task: ${thread.name}` : thread.name;
  id.textContent = getDisplaySubtitle(thread);
  id.title = thread.id;
  prompt.textContent = getPromptText(thread);
  prompt.title = thread.lastPrompt || thread.preview || thread.id;

  const meta = card.querySelector(".meta-grid");
  meta.append(
    makeMeta(thread.status === "running" ? "Running" : "Activity", formatRelative(thread.activityAt)),
    makeMeta("Mode", thread.permissionMode),
    makeMeta("Prompts", thread.promptCount || "0"),
  );
  if (thread.lastToolName) meta.append(makeMeta("Last tool", thread.lastToolName));
  if (thread.agentNickname) meta.append(makeMeta("Agent", thread.agentNickname));

  const badges = card.querySelector(".badges");
  badges.append(makeBadge(thread.statusLabel, thread.status));
  if (thread.runningStale) badges.append(makeBadge("stale", "warning"));
  if (thread.aborted) badges.append(makeBadge("aborted", "warning"));
  if (thread.unread) badges.append(makeBadge("unread", "danger"));
  if (thread.liveProcessCount) badges.append(makeBadge(`${thread.liveProcessCount} live terminal`, "process"));
  if (thread.fullAccess) badges.append(makeBadge("full access", "danger"));
  if (thread.liveProcessCount && thread.fullAccess) badges.append(makeBadge("live full access", "danger"));
  if (thread.goal?.status) badges.append(makeBadge(`goal ${thread.goal.status}`, thread.goal.status === "active" ? "process" : "warning"));
  if (thread.threadSource === "subagent") badges.append(makeBadge(thread.agentRole ? `subagent ${thread.agentRole}` : "subagent", "strong"));
  if (thread.childThreadCount) badges.append(makeBadge(`${thread.childThreadCount} children`, "strong"));
  if (thread.pinned) badges.append(makeBadge("pinned", "strong"));
  if (thread.projectless) badges.append(makeBadge("projectless"));
  if (thread.tokensUsed) badges.append(makeBadge(`${Intl.NumberFormat().format(thread.tokensUsed)} tokens`));
  if (thread.gitBranch) badges.append(makeBadge(thread.gitBranch));
  if (thread.workspace) badges.append(makeBadge(compactPath(thread.workspace)));
  if (thread.lastError) badges.append(makeBadge("error signal", "danger"));

  const time = card.querySelector("time");
  time.dateTime = thread.activityAt || "";
  time.textContent = formatClock(thread.activityAt);

  const open = card.querySelector(".open-link");
  open.href = thread.codexUrl;

  card.querySelector(".copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(thread.id);
  });

  return card;
}

function getFilteredThreads() {
  const query = normalize(state.query.trim());
  const filtered = state.threads.filter((thread) => {
    if (state.hideDone && thread.status === "done") return false;
    if (state.focusMode && ["today", "done"].includes(thread.status) && !thread.unread && !thread.liveProcessCount) return false;
    if (!state.activeStatuses.has(thread.status)) return false;
    if (state.quickFilter === "review" && !["complete", "recent"].includes(thread.status) && !thread.unread && !thread.goal) return false;
    if (state.quickFilter === "risk" && !thread.fullAccess && !thread.liveProcessCount && !thread.runningStale && !thread.aborted && !thread.lastError) return false;
    if (state.quickFilter === "unread" && !thread.unread) return false;
    if (state.quickFilter === "projectless" && !thread.projectless) return false;
    if (state.quickFilter === "subagents" && thread.threadSource !== "subagent" && !thread.childThreadCount) return false;
    return threadMatches(thread, query);
  });
  return sortThreads(filtered);
}

function statusRank(status) {
  return columns.findIndex((column) => column.id === status);
}

function sortThreads(threads) {
  return [...threads].sort((a, b) => {
    if (state.sortMode === "updated") return new Date(b.activityAt || 0) - new Date(a.activityAt || 0);
    if (state.sortMode === "running") {
      const aStart = new Date(a.runningSince || a.activityAt || 0).getTime();
      const bStart = new Date(b.runningSince || b.activityAt || 0).getTime();
      return aStart - bStart;
    }
    if (state.sortMode === "risk") {
      const risk = (thread) => Number(thread.liveProcessCount && thread.fullAccess) * 8 + Number(thread.runningStale) * 5 + Number(thread.aborted) * 4 + Number(thread.fullAccess) * 2 + Number(thread.unread);
      const delta = risk(b) - risk(a);
      if (delta) return delta;
      return new Date(b.activityAt || 0) - new Date(a.activityAt || 0);
    }

    const delta = statusRank(a.status) - statusRank(b.status);
    if (delta) return delta;
    return new Date(b.activityAt || 0) - new Date(a.activityAt || 0);
  });
}

function renderMetrics() {
  const summary = state.summary || { counts: {}, total: 0, unread: 0, liveProcesses: 0 };
  document.querySelector("#runningThreads").textContent = summary.counts?.running || 0;
  document.querySelector("#completeThreads").textContent = summary.counts?.complete || 0;
  document.querySelector("#recentThreads").textContent = summary.counts?.recent || 0;
  document.querySelector("#todayThreads").textContent = summary.counts?.today || 0;
  document.querySelector("#doneThreads").textContent = summary.counts?.done || 0;
  document.querySelector("#unreadThreads").textContent = summary.unread || 0;
  document.querySelector("#riskThreads").textContent = (summary.liveFullAccess || 0) + (summary.staleRunning || 0);
  document.querySelector("#updatedAt").textContent = state.lastSnapshotAt ? `Updated ${formatClock(state.lastSnapshotAt)}` : "--";
}

function renderSpotlight(filtered) {
  spotlight.replaceChildren();
  const running = state.threads.filter((thread) => thread.status === "running");
  const justFinished = state.threads.filter((thread) => ["complete", "recent"].includes(thread.status));
  const needsEyes = state.threads.filter((thread) => thread.unread || thread.runningStale || thread.lastError);

  const items = [
    { label: "Running now", value: running.length, detail: running[0] ? getDisplayTitle(running[0]) : "No active turns" },
    { label: "Finished in 2h", value: justFinished.length, detail: justFinished[0] ? getDisplayTitle(justFinished[0]) : "Nothing fresh yet" },
    { label: "Needs eyes", value: needsEyes.length, detail: needsEyes[0] ? getDisplayTitle(needsEyes[0]) : "Clear" },
    { label: "Visible cards", value: filtered.length, detail: state.focusMode ? "Focus mode active" : "All matching filters" },
  ];

  for (const item of items) {
    const tile = document.createElement("article");
    tile.className = "spotlight-tile";
    tile.innerHTML = `<span>${item.label}</span><strong>${item.value}</strong><p></p>`;
    tile.querySelector("p").textContent = item.detail;
    spotlight.append(tile);
  }
}

function renderBoard(filtered) {
  board.replaceChildren();

  for (const column of columns) {
    const el = columnTemplate.content.firstElementChild.cloneNode(true);
    const threads = filtered.filter((thread) => thread.status === column.id);
    el.dataset.status = column.id;
    el.querySelector("h2").textContent = column.title;
    el.querySelector("p").textContent = column.description;
    el.querySelector(".count").textContent = `(${threads.length})`;

    const cards = el.querySelector(".cards");
    if (threads.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No threads";
      cards.append(empty);
    } else {
      cards.append(...threads.map(renderCard));
    }

    board.append(el);
  }
}

function render() {
  renderStatusFilters();
  renderQuickFilters();
  const filtered = getFilteredThreads();
  renderMetrics();
  renderSpotlight(filtered);
  renderBoard(filtered);
}

async function applySnapshot(data) {
  state.threads = data.threads || [];
  state.summary = data.summary || null;
  state.lastSnapshotAt = data.refreshedAt || new Date().toISOString();
  document.querySelector("#source").textContent = data.error || `${data.indexPath || "No index"} | ${data.sessionsRoot || ""}`;
  document.querySelector("#connectionState").textContent = "Live";
  render();
}

async function loadThreads() {
  refresh.disabled = true;
  try {
    const response = await fetch("/api/threads");
    applySnapshot(await response.json());
  } catch (error) {
    document.querySelector("#connectionState").textContent = "Offline";
    document.querySelector("#source").textContent = error.message;
  } finally {
    refresh.disabled = false;
  }
}

function connectEvents() {
  if (!("EventSource" in window)) {
    setInterval(loadThreads, 5000);
    loadThreads();
    return;
  }

  const source = new EventSource("/api/events");
  source.addEventListener("snapshot", (event) => {
    applySnapshot(JSON.parse(event.data));
  });
  source.addEventListener("error", () => {
    document.querySelector("#connectionState").textContent = "Reconnecting";
  });
}

search.addEventListener("input", () => {
  state.query = search.value;
  render();
});

refresh.addEventListener("click", loadThreads);

focusMode.addEventListener("click", () => {
  state.focusMode = !state.focusMode;
  focusMode.setAttribute("aria-pressed", String(state.focusMode));
  render();
});

hideDone.addEventListener("change", () => {
  state.hideDone = hideDone.checked;
  render();
});

sortMode.addEventListener("change", () => {
  state.sortMode = sortMode.value;
  render();
});

setInterval(() => {
  if (state.threads.length) renderMetrics();
}, 1000);

renderStatusFilters();
renderQuickFilters();
connectEvents();
