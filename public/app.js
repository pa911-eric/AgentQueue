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
  activeTag: "",
  sortMode: "priority",
  viewMode: "board",
  mobileColumn: "running",
  hideDone: true,
  focusMode: false,
  panelCollapsed: false,
  panelWidth: 348,
  usage: null,
  selectedThreadId: null,
  lastSnapshotAt: null,
};

const preferencesKey = "agentqueue-preferences-v1";
const legacyPreferencesKey = "codex-thread-ops-preferences-v1";
const panelWidthDefaults = {
  min: 280,
  max: 620,
  default: 348,
  mobileBreakpoint: 720,
};
const board = document.querySelector("#board");
const columnTemplate = document.querySelector("#columnTemplate");
const cardTemplate = document.querySelector("#cardTemplate");
const search = document.querySelector("#search");
const refresh = document.querySelector("#refresh");
const focusMode = document.querySelector("#focusMode");
const hideDone = document.querySelector("#hideDone");
const statusFilters = document.querySelector("#statusFilters");
const quickFilters = document.querySelector("#quickFilters");
const tagFilterSection = document.querySelector("#tagFilterSection");
const tagFilters = document.querySelector("#tagFilters");
const viewModes = document.querySelector("#viewModes");
const sortMode = document.querySelector("#sortMode");
const sortTiers = document.querySelector("#sortTiers");
const columnSwitcher = document.querySelector("#columnSwitcher");
const panelToggle = document.querySelector("#panelToggle");
const controlPanel = document.querySelector("#controlPanel");
const panelResizeHandle = document.querySelector("#panelResizeHandle");
const detailDrawer = document.querySelector("#detailDrawer");
const closeDetail = document.querySelector("#closeDetail");
const detailKicker = document.querySelector("#detailKicker");
const detailTitle = document.querySelector("#detailTitle");
const detailSubtitle = document.querySelector("#detailSubtitle");
const detailContent = document.querySelector("#detailContent");
const cardMenu = document.querySelector("#cardMenu");
const tagSubmenu = document.querySelector("#tagSubmenu");
const usageDetail = document.querySelector("#usageDetail");
let menuThreadId = null;

const quickFilterDefs = [
  { id: "all", label: "All", tip: "Show every matching parent thread" },
  { id: "review", label: "Needs review", tip: "Show threads with unread, goal, or recent child activity" },
  { id: "risk", label: "Risk", tip: "Show threads with elevated permission, stale runs, live processes, warnings, or errors" },
  { id: "logs", label: "Logs", tip: "Show threads with warnings or errors in the last 24 hours" },
  { id: "tokens", label: "Token heavy", tip: "Show threads with high token usage" },
  { id: "unread", label: "Unread", tip: "Show unread parent or child threads" },
  { id: "projectless", label: "Projectless", tip: "Show threads without a project workspace" },
  { id: "subagents", label: "Subagents", tip: "Show subagent threads and parents with subagents" },
];

const viewModeDefs = [
  { id: "board", label: "Board", tip: "Show threads grouped by status columns" },
  { id: "list", label: "List", tip: "Show a condensed monitor list" },
];

const sortModeDefs = {
  priority: {
    label: "Tiered priority",
    tiers: ["Status lane", "Running user reply", "Needs review", "Risk", "Activity"],
  },
  updated: {
    label: "Activity first",
    tiers: ["Activity", "Status lane", "Running user reply", "Risk"],
  },
  running: {
    label: "Longest running",
    tiers: ["Running user reply", "Activity", "Risk", "Title"],
  },
  risk: {
    label: "Risk first",
    tiers: ["Risk", "Running user reply", "Activity", "Status lane"],
  },
};

function readPreferences() {
  try {
    const saved = localStorage.getItem(preferencesKey) || localStorage.getItem(legacyPreferencesKey);
    return JSON.parse(saved || "{}");
  } catch {
    return {};
  }
}

function savePreferences() {
  localStorage.setItem(preferencesKey, JSON.stringify({
    query: state.query,
    activeStatuses: Array.from(state.activeStatuses),
    quickFilter: state.quickFilter,
    activeTag: state.activeTag,
    sortMode: state.sortMode,
    viewMode: state.viewMode,
    mobileColumn: state.mobileColumn,
    hideDone: state.hideDone,
    focusMode: state.focusMode,
    panelCollapsed: state.panelCollapsed,
    panelWidth: state.panelWidth,
  }));
}

function restorePreferences() {
  const prefs = readPreferences();
  const validStatuses = new Set(columns.map((column) => column.id));
  const nextStatuses = Array.isArray(prefs.activeStatuses)
    ? prefs.activeStatuses.filter((id) => validStatuses.has(id))
    : [];

  if (typeof prefs.query === "string") state.query = prefs.query;
  if (nextStatuses.length) state.activeStatuses = new Set(nextStatuses);
  if (quickFilterDefs.some((filter) => filter.id === prefs.quickFilter)) state.quickFilter = prefs.quickFilter;
  if (typeof prefs.activeTag === "string") state.activeTag = prefs.activeTag;
  if (Object.hasOwn(sortModeDefs, prefs.sortMode)) state.sortMode = prefs.sortMode;
  if (viewModeDefs.some((mode) => mode.id === prefs.viewMode)) state.viewMode = prefs.viewMode;
  if (columns.some((column) => column.id === prefs.mobileColumn)) state.mobileColumn = prefs.mobileColumn;
  if (Object.hasOwn(prefs, "hideDone")) state.hideDone = Boolean(prefs.hideDone);
  if (Number.isFinite(Number(prefs.panelWidth))) state.panelWidth = Number(prefs.panelWidth);
  state.focusMode = Boolean(prefs.focusMode);
  state.panelCollapsed = Boolean(prefs.panelCollapsed);

  search.value = state.query;
  sortMode.value = state.sortMode;
  hideDone.checked = state.hideDone;
  focusMode.setAttribute("aria-pressed", String(state.focusMode));
  applyPanelWidth(state.panelWidth, false);
  setPanelCollapsed(state.panelCollapsed, false);
}

function normalize(value) {
  return String(value || "").toLowerCase();
}

function normalizeTag(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_.:-]/g, "")
    .toLowerCase()
    .slice(0, 40);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function formatDurationMs(value) {
  if (value == null) return "--";
  const ms = Math.max(0, Number(value));
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (ms < minute) return "now";
  if (ms < hour) return `${Math.round(ms / minute)}m`;
  if (ms < day) return `${Math.round(ms / hour)}h`;
  return `${Math.round(ms / day)}d`;
}

function formatPercent(value) {
  if (!Number.isFinite(Number(value))) return "--";
  return `${Math.round(Number(value))}%`;
}

function compactPath(value) {
  if (!value) return "";
  const parts = String(value).split(/[\\/]/).filter(Boolean);
  if (parts.length <= 3) return value;
  return `${parts.at(-3)} / ${parts.at(-2)} / ${parts.at(-1)}`;
}

function getThreadById(id) {
  return state.threads.find((thread) => thread.id === id) || null;
}

function getParentThread(thread) {
  if (!thread.parentThreadId) return null;
  return getThreadById(thread.parentThreadId);
}

function getChildThreads(thread) {
  return state.threads.filter((candidate) => candidate.parentThreadId === thread.id);
}

function statusPriority(status) {
  const index = columns.findIndex((column) => column.id === status);
  return index === -1 ? columns.length : index;
}

function getEffectiveStatus(thread) {
  if (thread.threadSource === "subagent") return thread.status;
  return [thread, ...getChildThreads(thread)]
    .map((item) => item.status)
    .sort((a, b) => statusPriority(a) - statusPriority(b))[0] || thread.status;
}

function childStats(thread) {
  const children = getChildThreads(thread);
  return {
    total: children.length,
    running: children.filter((child) => child.status === "running").length,
    recent: children.filter((child) => ["complete", "recent"].includes(child.status)).length,
    unread: children.filter((child) => child.unread).length,
    warnings: children.reduce((sum, child) => sum + (child.logHealth?.warnings24h || 0), 0),
    errors: children.reduce((sum, child) => sum + (child.logHealth?.errors24h || 0), 0),
    liveProcesses: children.reduce((sum, child) => sum + (child.liveProcessCount || 0), 0),
    tokens: children.reduce((sum, child) => sum + (child.tokensUsed || 0), 0),
    activeGoals: children.filter((child) => child.goal?.status === "active").length,
  };
}

function getThreadTags(thread, includeChildren = false) {
  const tags = new Set(Array.isArray(thread.tags) ? thread.tags : []);
  if (includeChildren) {
    for (const child of getChildThreads(thread)) {
      for (const tag of child.tags || []) tags.add(tag);
    }
  }
  return Array.from(tags).sort((a, b) => a.localeCompare(b));
}

function getDisplayTitle(thread) {
  if (thread.threadSource !== "subagent") return thread.name;
  return getParentThread(thread)?.name || "Subagent";
}

function getDisplaySubtitle(thread) {
  if (thread.threadSource !== "subagent") {
    const children = getChildThreads(thread).length;
    if (children) return `${children} subagents`;
    if (thread.projectless) return "Projectless";
    return `ID: ${thread.id.slice(0, 8)}`;
  }
  const agent = thread.agentNickname || "Subagent";
  const role = thread.agentRole ? ` / ${thread.agentRole}` : "";
  return `${agent}${role} subagent`;
}

function getProjectLabel(thread) {
  const parent = getParentThread(thread);
  return compactPath(thread.workspace || thread.outputDirectory || parent?.workspace || parent?.outputDirectory);
}

function getPromptText(thread) {
  if (thread.threadSource !== "subagent") return thread.preview || thread.lastPrompt || thread.id;
  const agent = thread.agentNickname || "subagent";
  return `Delegated to ${agent}. Open details for the full task.`;
}

function getOriginalTask(thread) {
  return thread.preview || thread.lastPrompt || thread.name || "";
}

function threadHasRisk(thread) {
  const stats = childStats(thread);
  return Boolean(
    thread.fullAccess ||
    thread.liveProcessCount ||
    thread.runningStale ||
    thread.aborted ||
    thread.lastError ||
    thread.logHealth?.errors24h ||
    thread.logHealth?.warnings24h ||
    stats.liveProcesses ||
    stats.errors ||
    stats.warnings
  );
}

function threadNeedsReview(thread) {
  const stats = childStats(thread);
  return ["complete", "recent"].includes(getEffectiveStatus(thread)) || thread.unread || thread.goal || stats.recent || stats.unread;
}

function threadHasLogs(thread) {
  const stats = childStats(thread);
  return Boolean(thread.logHealth?.errors24h || thread.logHealth?.warnings24h || stats.errors || stats.warnings);
}

function threadIsTokenHeavy(thread) {
  const stats = childStats(thread);
  return (thread.tokensUsed || 0) + stats.tokens >= 10_000_000;
}

function threadMatches(thread, query) {
  if (!query) return true;
  const parent = getParentThread(thread);
  const tags = getThreadTags(thread, true);
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
    tags.join(" "),
  ].map(normalize).join(" ");
  return haystack.includes(query);
}

function threadMatchesActiveTag(thread) {
  if (!state.activeTag) return true;
  return getThreadTags(thread, true).includes(state.activeTag);
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
  const visibleStatusColumns = state.hideDone ? columns.filter((column) => column.id !== "done") : columns;
  for (const column of visibleStatusColumns) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.status = column.id;
    button.textContent = column.title;
    button.title = `Toggle ${column.title} column`;
    button.setAttribute("aria-pressed", String(state.activeStatuses.has(column.id)));
    button.addEventListener("click", () => {
      if (state.activeStatuses.has(column.id)) state.activeStatuses.delete(column.id);
      else state.activeStatuses.add(column.id);
      if (state.activeStatuses.size === 0) state.activeStatuses = new Set(columns.map((item) => item.id));
      savePreferences();
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
    button.title = filter.tip;
    button.setAttribute("aria-pressed", String(state.quickFilter === filter.id));
    button.addEventListener("click", () => {
      state.quickFilter = filter.id;
      savePreferences();
      render();
    });
    quickFilters.append(button);
  }
}

function renderViewModes() {
  viewModes.replaceChildren();
  for (const mode of viewModeDefs) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = mode.label;
    button.title = mode.tip;
    button.setAttribute("aria-pressed", String(state.viewMode === mode.id));
    button.addEventListener("click", () => {
      state.viewMode = mode.id;
      savePreferences();
      render();
    });
    viewModes.append(button);
  }
}

function renderSortTiers() {
  const mode = sortModeDefs[state.sortMode] || sortModeDefs.priority;
  sortTiers.replaceChildren();
  sortTiers.title = `${mode.label}: ${mode.tiers.join(" > ")}`;

  for (const [index, tier] of mode.tiers.entries()) {
    const chip = document.createElement("span");
    chip.textContent = index === 0 ? tier : `> ${tier}`;
    sortTiers.append(chip);
  }
}

function getTagCounts() {
  const counts = state.summary?.tagCounts || {};
  return Object.entries(counts)
    .filter(([tag, count]) => tag && count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function renderTagFilters() {
  const tagCounts = getTagCounts();
  tagFilterSection.hidden = tagCounts.length === 0;
  tagFilters.replaceChildren();
  if (!tagCounts.length) {
    state.activeTag = "";
    return;
  }

  if (state.activeTag && !tagCounts.some(([tag]) => tag === state.activeTag)) {
    state.activeTag = "";
    savePreferences();
  }

  const all = document.createElement("button");
  all.type = "button";
  all.textContent = "All";
  all.title = "Clear tag filter";
  all.setAttribute("aria-pressed", String(!state.activeTag));
  all.addEventListener("click", () => {
    state.activeTag = "";
    savePreferences();
    render();
  });
  tagFilters.append(all);

  for (const [tag, count] of tagCounts) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${tag} ${count}`;
    button.title = `Show threads tagged ${tag}`;
    button.setAttribute("aria-pressed", String(state.activeTag === tag));
    button.addEventListener("click", () => {
      state.activeTag = state.activeTag === tag ? "" : tag;
      savePreferences();
      render();
    });
    tagFilters.append(button);
  }
}

function renderCard(thread) {
  const card = cardTemplate.content.firstElementChild.cloneNode(true);
  const displayStatus = thread.displayStatus || thread.status;
  const stats = childStats(thread);
  card.dataset.status = displayStatus;
  card.classList.toggle("is-unread", thread.unread || Boolean(stats.unread));
  card.classList.toggle("is-stale", thread.runningStale);
  card.classList.toggle("is-subagent", thread.threadSource === "subagent");
  card.tabIndex = 0;

  const title = card.querySelector("h3");
  const id = card.querySelector(".thread-id");
  const prompt = card.querySelector(".prompt");
  const unreadIndicator = card.querySelector(".unread-indicator");
  title.textContent = getDisplayTitle(thread);
  title.title = thread.threadSource === "subagent" ? `Parent: ${getDisplayTitle(thread)}\nSubagent task: ${thread.name}` : thread.name;
  id.textContent = getDisplaySubtitle(thread);
  id.title = thread.id;
  prompt.textContent = getPromptText(thread);
  prompt.title = getOriginalTask(thread);
  if (thread.unread || stats.unread) {
    unreadIndicator.hidden = false;
    unreadIndicator.textContent = thread.unread ? "Unread" : `${stats.unread} unread`;
    unreadIndicator.title = thread.unread ? "Unread thread" : `${stats.unread} unread subagent${stats.unread === 1 ? "" : "s"}`;
  }

  const meta = card.querySelector(".meta-grid");
  meta.append(makeMeta(displayStatus === "running" ? "Running" : "Activity", formatRelative(thread.activityAt)));
  if (stats.total) meta.append(makeMeta("Subagents", `${stats.total}${stats.running ? ` / ${stats.running} running` : ""}`));
  else if (thread.threadSource === "subagent" && thread.agentNickname) meta.append(makeMeta("Agent", thread.agentNickname));
  if (thread.liveProcessCount || stats.liveProcesses) meta.append(makeMeta("Terminals", thread.liveProcessCount + stats.liveProcesses));
  if (thread.logHealth?.errors24h || stats.errors) meta.append(makeMeta("Errors", thread.logHealth.errors24h + stats.errors));
  else if (thread.logHealth?.warnings24h || stats.warnings) meta.append(makeMeta("Warnings", thread.logHealth.warnings24h + stats.warnings));

  const badges = card.querySelector(".badges");
  if (thread.goal?.status === "active" || stats.activeGoals) badges.append(makeBadge(stats.activeGoals > 1 ? `${stats.activeGoals} active goals` : "goal active", "process"));
  for (const tag of getThreadTags(thread, false)) badges.append(makeBadge(tag, "tag"));
  const projectLabel = getProjectLabel(thread);
  if (projectLabel) badges.append(makeBadge(projectLabel, "project"));
  if (!badges.children.length) badges.hidden = true;

  const childSummary = card.querySelector(".child-summary");
  if (stats.total) {
    childSummary.textContent = [
      stats.running ? `${stats.running} running` : null,
      stats.recent ? `${stats.recent} recently finished` : null,
    ].filter(Boolean).join(" - ");
  } else {
    childSummary.hidden = true;
  }

  const time = card.querySelector("time");
  time.dateTime = thread.activityAt || "";
  time.textContent = formatClock(thread.activityAt);

  card.addEventListener("click", (event) => {
    if (event.target.closest("a, button")) return;
    showDetails(thread.id);
  });

  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter") showDetails(thread.id);
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      const rect = card.getBoundingClientRect();
      showCardMenu(thread.id, rect.left + 24, rect.top + 24);
    }
  });

  card.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    showCardMenu(thread.id, event.clientX, event.clientY);
  });

  return card;
}

function getBoardThreads() {
  const query = normalize(state.query.trim());
  const showSubagents = state.quickFilter === "subagents" || Boolean(query);
  const base = state.threads
    .filter((thread) => showSubagents || thread.threadSource !== "subagent" || !getParentThread(thread))
    .map((thread) => ({ ...thread, displayStatus: getEffectiveStatus(thread) }));

  return sortThreads(base.filter((thread) => {
    if (state.hideDone && thread.displayStatus === "done") return false;
    if (state.focusMode && ["today", "done"].includes(thread.displayStatus) && !threadNeedsReview(thread) && !threadHasRisk(thread)) return false;
    if (!state.activeStatuses.has(thread.displayStatus)) return false;
    if (!threadMatchesActiveTag(thread)) return false;
    if (state.quickFilter === "review" && !threadNeedsReview(thread)) return false;
    if (state.quickFilter === "risk" && !threadHasRisk(thread)) return false;
    if (state.quickFilter === "logs" && !threadHasLogs(thread)) return false;
    if (state.quickFilter === "tokens" && !threadIsTokenHeavy(thread)) return false;
    if (state.quickFilter === "unread" && !thread.unread && !childStats(thread).unread) return false;
    if (state.quickFilter === "projectless" && !thread.projectless) return false;
    if (state.quickFilter === "subagents" && thread.threadSource !== "subagent" && !childStats(thread).total) return false;
    return threadMatches(thread, query);
  }));
}

function statusRank(status) {
  return columns.findIndex((column) => column.id === status);
}

function timeValue(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function runningAnchor(thread) {
  return timeValue(thread.lastUserAt || thread.runningSince || thread.activityAt);
}

function riskScore(thread) {
  const stats = childStats(thread);
  return Number(threadHasRisk(thread)) * 5
    + Number((thread.liveProcessCount || stats.liveProcesses) && thread.fullAccess) * 8
    + Number(thread.runningStale) * 4
    + ((thread.logHealth?.errors24h || 0) + stats.errors) * 3
    + ((thread.logHealth?.warnings24h || 0) + stats.warnings)
    + Number(thread.fullAccess) * 2
    + Number(thread.unread || stats.unread) * 2;
}

function compareNumber(a, b, direction = "desc") {
  const delta = a - b;
  return direction === "asc" ? delta : -delta;
}

function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""));
}

function compareRunningUserReply(a, b, direction = "desc") {
  const aRunning = (a.displayStatus || a.status) === "running";
  const bRunning = (b.displayStatus || b.status) === "running";
  if (aRunning !== bRunning) return Number(bRunning) - Number(aRunning);
  if (!aRunning && !bRunning) return 0;
  return compareNumber(runningAnchor(a), runningAnchor(b), direction);
}

function compareByActivity(a, b) {
  return compareNumber(timeValue(a.activityAt), timeValue(b.activityAt), "desc");
}

function compareByRisk(a, b) {
  return compareNumber(riskScore(a), riskScore(b), "desc");
}

function compareByStatus(a, b) {
  return statusRank(a.displayStatus || a.status) - statusRank(b.displayStatus || b.status);
}

function compareStable(a, b) {
  return compareText(getDisplayTitle(a), getDisplayTitle(b)) || compareText(a.id, b.id);
}

function sortThreads(threads) {
  return [...threads].sort((a, b) => {
    if (state.sortMode === "updated") {
      return compareByActivity(a, b)
        || compareByStatus(a, b)
        || compareRunningUserReply(a, b, "desc")
        || compareByRisk(a, b)
        || compareStable(a, b);
    }

    if (state.sortMode === "running") {
      return compareRunningUserReply(a, b, "asc")
        || compareByActivity(a, b)
        || compareByRisk(a, b)
        || compareStable(a, b);
    }

    if (state.sortMode === "risk") {
      return compareByRisk(a, b)
        || compareRunningUserReply(a, b, "desc")
        || compareByActivity(a, b)
        || compareByStatus(a, b)
        || compareStable(a, b);
    }

    return compareByStatus(a, b)
      || compareRunningUserReply(a, b, "desc")
      || Number(threadNeedsReview(b)) - Number(threadNeedsReview(a))
      || compareByRisk(a, b)
      || compareByActivity(a, b)
      || compareStable(a, b);
  });
}

function renderMetrics() {
  const summary = state.summary || { counts: {}, total: 0, unread: 0 };
  document.querySelector("#runningThreads").textContent = summary.counts?.running || 0;
  document.querySelector("#completeThreads").textContent = summary.counts?.complete || 0;
  document.querySelector("#recentThreads").textContent = summary.counts?.recent || 0;
  document.querySelector("#todayThreads").textContent = summary.counts?.today || 0;
  document.querySelector("#doneThreads").textContent = summary.counts?.done || 0;
  document.querySelector("#unreadThreads").textContent = summary.unread || 0;
  document.querySelector("#riskThreads").textContent = (summary.liveFullAccess || 0) + (summary.staleRunning || 0) + (summary.logErrors24h || 0);
  document.querySelector("#updatedAt").textContent = state.lastSnapshotAt ? `Updated ${formatClock(state.lastSnapshotAt)}` : "--";
}

function usageLimitLabel(window) {
  if (!window) return "Usage limit";
  if (window.windowMinutes <= 360) return `${Math.round(window.windowMinutes / 60)} hour usage limit`;
  if (window.windowMinutes >= 7 * 24 * 60) return "Weekly usage limit";
  return `${window.label || "Usage"} usage limit`;
}

function usageShortLabel(window) {
  if (!window) return "Usage";
  if (window.windowMinutes <= 360) return `${Math.round(window.windowMinutes / 60)}h`;
  if (window.windowMinutes >= 7 * 24 * 60) return "Weekly";
  return window.label || "Usage";
}

function usageShortResetText(window) {
  if (window?.resetInMs == null) return "reset --";
  return `reset ${formatDurationMs(window.resetInMs)}`;
}

function usageExhaustionText(window) {
  if (!window) return "empty --";
  if (window.exhaustionConfidence === "after reset") return "not before reset";
  if (window.exhaustionConfidence === "flat") return "flat";
  if (window.exhaustionConfidence === "insufficient") return "need samples";
  if (window.exhaustionInMs == null) return "empty --";
  return `empty ${formatDurationMs(window.exhaustionInMs)}`;
}

function usageBurnText(window) {
  const burn = Number(window?.slopePercentPerHour);
  if (!Number.isFinite(burn) || burn <= 0) return "burn --";
  return `burn ${burn.toFixed(1)}%/h`;
}

function renderUsageDetailWindow(window) {
  if (!window) return "";
  const usedPercent = Math.max(0, Math.min(100, window.usedPercent));
  const remaining = formatPercent(window.remainingPercent);
  const label = usageShortLabel(window);
  const title = `${usageLimitLabel(window)}. ${usageBurnText(window)}. ${usageExhaustionText(window)}. ${usageShortResetText(window)}.`;

  return `
    <article class="usage-detail-row" title="${escapeHtml(title)}">
      <div class="usage-detail-top">
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(remaining)} left</span>
      </div>
      <div class="usage-bar" aria-hidden="true"><span style="width: ${usedPercent}%"></span></div>
      <p>${escapeHtml(usageBurnText(window))} / ${escapeHtml(usageExhaustionText(window))} / ${escapeHtml(usageShortResetText(window))}</p>
    </article>
  `;
}

function renderUsage() {
  const usage = state.usage;
  if (!usage?.available) {
    usageDetail.hidden = true;
    return;
  }

  const detailRows = [renderUsageDetailWindow(usage.primary), renderUsageDetailWindow(usage.secondary)].filter(Boolean).join("");
  usageDetail.hidden = !detailRows;
  usageDetail.innerHTML = detailRows;
}

function renderBoard(filtered) {
  board.replaceChildren();

  const visibleColumns = state.hideDone ? columns.filter((column) => column.id !== "done") : columns;
  if (!visibleColumns.some((column) => column.id === state.mobileColumn)) {
    state.mobileColumn = visibleColumns[0]?.id || "running";
  }

  renderColumnSwitcher(filtered, visibleColumns);
  board.className = state.viewMode === "list" ? "board monitor-list" : "board";
  board.setAttribute("aria-label", state.viewMode === "list" ? "Codex thread monitor list" : "Codex thread board");
  board.dataset.columnCount = String(visibleColumns.length);
  board.dataset.view = state.viewMode;

  if (state.viewMode === "list") {
    renderThreadList(filtered);
    return;
  }

  for (const column of visibleColumns) {
    const el = columnTemplate.content.firstElementChild.cloneNode(true);
    const threads = filtered.filter((thread) => thread.displayStatus === column.id);
    el.dataset.status = column.id;
    el.classList.toggle("is-mobile-hidden", column.id !== state.mobileColumn);
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

function renderColumnSwitcher(filtered, visibleColumns) {
  columnSwitcher.replaceChildren();
  columnSwitcher.hidden = state.viewMode !== "board";
  if (columnSwitcher.hidden) return;

  for (const column of visibleColumns) {
    const count = filtered.filter((thread) => thread.displayStatus === column.id).length;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${column.title} (${count})`;
    button.setAttribute("aria-pressed", String(state.mobileColumn === column.id));
    button.addEventListener("click", () => {
      state.mobileColumn = column.id;
      savePreferences();
      render();
    });
    columnSwitcher.append(button);
  }
}

function renderThreadList(filtered) {
  const header = document.createElement("div");
  header.className = "monitor-row monitor-header";
  header.innerHTML = `
    <span>Status</span>
    <span>Thread</span>
    <span>Activity</span>
    <span>Risk</span>
  `;
  board.append(header);

  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No threads";
    board.append(empty);
    return;
  }

  for (const thread of filtered) {
    const stats = childStats(thread);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "monitor-row";
    row.dataset.status = thread.displayStatus;
    row.addEventListener("click", () => showDetails(thread.id));

    const riskItems = [
      thread.fullAccess ? "full access" : null,
      thread.liveProcessCount || stats.liveProcesses ? "terminal" : null,
      thread.logHealth?.errors24h || stats.errors ? "errors" : null,
      thread.logHealth?.warnings24h || stats.warnings ? "warnings" : null,
      thread.runningStale ? "stale" : null,
    ].filter(Boolean);

    row.innerHTML = `
      <span class="status-cell"><span class="badge ${escapeHtml(thread.displayStatus)}">${escapeHtml(thread.statusLabel || thread.displayStatus)}</span></span>
      <span class="thread-cell">
        <strong>${escapeHtml(getDisplayTitle(thread))}</strong>
        <small>${escapeHtml(thread.id)}</small>
      </span>
      <span>${escapeHtml(formatRelative(thread.activityAt))}</span>
      <span>${escapeHtml(riskItems.join(", ") || "-")}</span>
    `;
    board.append(row);
  }
}

function detailRow(label, value) {
  if (!value && value !== 0) return "";
  return `<div class="detail-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function renderChildList(thread) {
  const children = getChildThreads(thread);
  if (!children.length) return "";
  const rows = children
    .sort((a, b) => statusPriority(a.status) - statusPriority(b.status) || new Date(b.activityAt || 0) - new Date(a.activityAt || 0))
    .map((child) => `
      <button class="child-row" type="button" data-thread-id="${escapeHtml(child.id)}">
        <span>${escapeHtml(child.agentNickname || child.agentRole || "Subagent")}</span>
        <strong>${escapeHtml(child.statusLabel)} - ${escapeHtml(formatRelative(child.activityAt))}</strong>
        <small>${escapeHtml(getOriginalTask(child).slice(0, 130))}</small>
      </button>
    `).join("");
  return `<section class="detail-section"><h3>Subagents</h3><div class="child-list">${rows}</div></section>`;
}

function renderParentLink(thread, parent) {
  if (thread.threadSource !== "subagent" || !parent) return "";
  return `
    <section class="detail-parent-nav" aria-label="Parent thread">
      <button class="parent-row" type="button" data-thread-id="${escapeHtml(parent.id)}" title="Back to parent thread details">
        <span>Back to parent</span>
        <strong>${escapeHtml(parent.name)}</strong>
      </button>
    </section>
  `;
}

function renderDetailBadges(thread) {
  const stats = childStats(thread);
  const badges = [];
  badges.push(makeBadge(thread.statusLabel, thread.status).outerHTML);
  if (thread.threadSource === "subagent") badges.push(makeBadge(thread.agentRole ? `subagent ${thread.agentRole}` : "subagent", "strong").outerHTML);
  if (stats.total) badges.push(makeBadge(`${stats.total} subagents`, "strong").outerHTML);
  if (thread.fullAccess) badges.push(makeBadge("full access", "danger").outerHTML);
  if (thread.liveProcessCount || stats.liveProcesses) badges.push(makeBadge(`${thread.liveProcessCount + stats.liveProcesses} live terminal`, "process").outerHTML);
  if (thread.logHealth?.errors24h || stats.errors) badges.push(makeBadge(`${thread.logHealth.errors24h + stats.errors} errors`, "danger").outerHTML);
  if (thread.logHealth?.warnings24h || stats.warnings) badges.push(makeBadge(`${thread.logHealth.warnings24h + stats.warnings} warnings`, "warning").outerHTML);
  if (thread.goal?.status) badges.push(makeBadge(`goal ${thread.goal.status}`, "process").outerHTML);
  for (const tag of getThreadTags(thread, false)) badges.push(makeBadge(tag, "tag").outerHTML);
  return `<div class="badges detail-badges">${badges.join("")}</div>`;
}

function renderTagEditor(thread) {
  const tags = getThreadTags(thread, false);
  const chips = tags.length
    ? tags.map((tag) => `
      <button class="tag-chip" type="button" data-remove-tag="${escapeHtml(tag)}" title="Remove ${escapeHtml(tag)}">
        <span>${escapeHtml(tag)}</span>
        <strong aria-hidden="true">x</strong>
      </button>
    `).join("")
    : `<p class="tag-empty">No tags yet</p>`;

  return `
    <section class="detail-section tag-editor-section">
      <h3>Tags</h3>
      <div class="tag-chip-list">${chips}</div>
      <form id="tagEditor" class="tag-editor">
        <input name="tag" type="text" maxlength="40" placeholder="Add tag" autocomplete="off" />
        <button type="submit">Add</button>
      </form>
    </section>
  `;
}

function showDetails(threadId) {
  const thread = getThreadById(threadId);
  if (!thread) return;
  const parent = getParentThread(thread);
  const stats = childStats(thread);
  state.selectedThreadId = threadId;

  detailKicker.textContent = thread.threadSource === "subagent" ? "Subagent" : "Thread";
  detailTitle.textContent = getDisplayTitle(thread);
  detailSubtitle.textContent = thread.threadSource === "subagent"
    ? `${thread.agentNickname || "Subagent"}${thread.agentRole ? ` / ${thread.agentRole}` : ""}`
    : thread.id;

  detailContent.innerHTML = `
    ${renderParentLink(thread, parent)}
    ${renderDetailBadges(thread)}
    <section class="detail-section">
      <h3>Overview</h3>
      <p>${escapeHtml(getOriginalTask(thread))}</p>
    </section>
    ${renderTagEditor(thread)}
    <section class="detail-grid">
      ${detailRow("Activity", formatRelative(thread.activityAt))}
      ${detailRow("Updated", formatClock(thread.activityAt))}
      ${detailRow("Permission", thread.permissionMode)}
      ${detailRow("Approval", thread.approvalPolicy)}
      ${detailRow("Tokens", Intl.NumberFormat().format((thread.tokensUsed || 0) + stats.tokens))}
      ${detailRow("Prompts", thread.promptCount)}
      ${detailRow("Workspace", compactPath(thread.workspace))}
      ${detailRow("Git branch", thread.gitBranch)}
      ${detailRow("Last tool", thread.lastToolName)}
      ${detailRow("Logs 24h", `${thread.logHealth?.errors24h || 0} errors / ${thread.logHealth?.warnings24h || 0} warnings`)}
      ${parent ? detailRow("Parent", parent.name) : ""}
    </section>
    ${thread.liveProcesses?.length ? `<section class="detail-section"><h3>Live Commands</h3>${thread.liveProcesses.map((item) => `<pre>${escapeHtml(item.command)}</pre>`).join("")}</section>` : ""}
    ${renderChildList(thread)}
    <section class="detail-actions">
      <a class="open-link" href="${escapeHtml(thread.codexUrl)}">Open in Codex</a>
      <button id="copyDetailId" type="button">Copy Thread ID</button>
    </section>
  `;

  detailContent.querySelectorAll(".child-row").forEach((row) => {
    row.addEventListener("click", () => showDetails(row.dataset.threadId));
  });
  detailContent.querySelector(".parent-row")?.addEventListener("click", (event) => {
    showDetails(event.currentTarget.dataset.threadId);
  });
  detailContent.querySelector("#copyDetailId")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(thread.id);
  });
  detailContent.querySelector("#tagEditor")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = event.currentTarget.elements.tag;
    const tag = normalizeTag(input.value);
    if (!tag) return;
    const tags = Array.from(new Set([...getThreadTags(thread, false), tag]));
    input.value = "";
    updateThreadTags(thread.id, tags).catch((error) => {
      document.querySelector("#updatedAt").textContent = `Issue: ${error.message}`;
    });
  });
  detailContent.querySelectorAll("[data-remove-tag]").forEach((button) => {
    button.addEventListener("click", () => {
      const removeTag = button.dataset.removeTag;
      updateThreadTags(thread.id, getThreadTags(thread, false).filter((tag) => tag !== removeTag)).catch((error) => {
        document.querySelector("#updatedAt").textContent = `Issue: ${error.message}`;
      });
    });
  });

  detailDrawer.hidden = false;
  document.body.classList.add("detail-open");
}

function focusTagEditor() {
  const input = detailContent.querySelector("#tagEditor input[name='tag']");
  if (!input) return;
  input.focus();
  input.select();
  input.scrollIntoView({ block: "center", behavior: "smooth" });
}

function closeDetails() {
  detailDrawer.hidden = true;
  state.selectedThreadId = null;
  document.body.classList.remove("detail-open");
}

function getReadActionIds(thread, includeChildren = false) {
  const ids = [thread.id];
  if (includeChildren) ids.push(...getChildThreads(thread).map((child) => child.id));
  return Array.from(new Set(ids));
}

async function markRead(thread, includeChildren = false) {
  const threadIds = getReadActionIds(thread, includeChildren);
  const response = await fetch("/api/threads/read", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ threadIds }),
  });

  if (!response.ok) throw new Error(`Mark read failed: ${response.status}`);

  const ids = new Set(threadIds);
  state.threads = state.threads.map((item) => ids.has(item.id) ? { ...item, unread: false } : item);
  render();
  await loadThreads();
}

async function updateThreadTags(threadId, tags) {
  const response = await fetch("/api/threads/tags", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ threadId, tags }),
  });

  if (!response.ok) throw new Error(`Tag update failed: ${response.status}`);

  const result = await response.json();
  state.threads = state.threads.map((item) => (
    item.id === threadId ? { ...item, tags: result.tags || [] } : item
  ));
  render();
  await loadThreads();
}

function setMenuItemHidden(action, hidden) {
  const item = cardMenu.querySelector(`[data-action="${action}"]`);
  if (item) item.hidden = hidden;
}

function renderTagSubmenu(thread) {
  const threadTags = new Set(getThreadTags(thread, false));
  const tagCounts = getTagCounts();
  tagSubmenu.replaceChildren();

  if (tagCounts.length) {
    for (const [tag, count] of tagCounts) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.action = "toggle-tag";
      button.dataset.tag = tag;
      button.setAttribute("role", "menuitemcheckbox");
      button.setAttribute("aria-checked", String(threadTags.has(tag)));
      button.title = threadTags.has(tag) ? `Remove ${tag}` : `Add ${tag}`;

      const label = document.createElement("span");
      label.textContent = `${threadTags.has(tag) ? "✓ " : ""}${tag}`;
      const meta = document.createElement("small");
      meta.textContent = String(count);
      button.append(label, meta);
      tagSubmenu.append(button);
    }

    tagSubmenu.append(document.createElement("hr"));
  } else {
    const empty = document.createElement("button");
    empty.type = "button";
    empty.disabled = true;
    empty.textContent = "No tags";
    tagSubmenu.append(empty, document.createElement("hr"));
  }

  const newTag = document.createElement("button");
  newTag.type = "button";
  newTag.dataset.action = "new-tag";
  newTag.setAttribute("role", "menuitem");
  newTag.textContent = "New Tag";
  tagSubmenu.append(newTag);
}

function showCardMenu(threadId, x, y) {
  const thread = getThreadById(threadId);
  if (!thread) return;

  const stats = childStats(thread);
  menuThreadId = threadId;

  setMenuItemHidden("mark-read", !thread.unread);
  setMenuItemHidden("mark-family-read", !(stats.total && (thread.unread || stats.unread)));
  renderTagSubmenu(thread);
  const tagsMenu = cardMenu.querySelector('[data-menu="tags"]');
  tagsMenu?.classList.remove("is-open", "align-left");
  cardMenu.querySelector('[data-action="tags-menu"]')?.setAttribute("aria-expanded", "false");

  cardMenu.hidden = false;
  cardMenu.style.left = "0px";
  cardMenu.style.top = "0px";

  const rect = cardMenu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  cardMenu.style.left = `${Math.max(8, left)}px`;
  cardMenu.style.top = `${Math.max(8, top)}px`;
  if (left + rect.width + 210 > window.innerWidth) tagsMenu?.classList.add("align-left");
  cardMenu.querySelector("button:not([hidden])")?.focus();
}

function closeCardMenu() {
  cardMenu.hidden = true;
  cardMenu.querySelector('[data-menu="tags"]')?.classList.remove("is-open");
  cardMenu.querySelector('[data-action="tags-menu"]')?.setAttribute("aria-expanded", "false");
  menuThreadId = null;
}

async function handleMenuAction(action, actionTarget = null) {
  const thread = getThreadById(menuThreadId);
  if (!thread) return;

  if (action === "tags-menu") {
    const submenu = cardMenu.querySelector('[data-menu="tags"]');
    const trigger = cardMenu.querySelector('[data-action="tags-menu"]');
    const open = !submenu?.classList.contains("is-open");
    submenu?.classList.toggle("is-open", open);
    trigger?.setAttribute("aria-expanded", String(open));
    return;
  }

  const tag = normalizeTag(actionTarget?.dataset.tag);
  closeCardMenu();

  if (action === "details") showDetails(thread.id);
  if (action === "new-tag") {
    showDetails(thread.id);
    requestAnimationFrame(focusTagEditor);
  }
  if (action === "toggle-tag") {
    if (!tag) return;
    const tags = new Set(getThreadTags(thread, false));
    if (tags.has(tag)) tags.delete(tag);
    else tags.add(tag);
    await updateThreadTags(thread.id, Array.from(tags));
  }
  if (action === "open") window.location.href = thread.codexUrl;
  if (action === "copy-id") await navigator.clipboard.writeText(thread.id);
  if (action === "copy-link") await navigator.clipboard.writeText(thread.codexUrl);
  if (action === "copy-title") await navigator.clipboard.writeText(getDisplayTitle(thread));
  if (action === "mark-read") await markRead(thread, false);
  if (action === "mark-family-read") await markRead(thread, true);
}

function getPanelMaxWidth() {
  const viewportMax = Math.floor(window.innerWidth * 0.52);
  return Math.max(panelWidthDefaults.min, Math.min(panelWidthDefaults.max, viewportMax));
}

function clampPanelWidth(value) {
  const width = Number(value);
  const fallback = Number.isFinite(width) ? width : panelWidthDefaults.default;
  return Math.round(Math.max(panelWidthDefaults.min, Math.min(getPanelMaxWidth(), fallback)));
}

function updatePanelResizeHandle(width) {
  const max = getPanelMaxWidth();
  panelResizeHandle.setAttribute("aria-valuemin", String(panelWidthDefaults.min));
  panelResizeHandle.setAttribute("aria-valuemax", String(max));
  panelResizeHandle.setAttribute("aria-valuenow", String(width));
  panelResizeHandle.setAttribute("aria-valuetext", `${width}px`);
}

function applyPanelWidth(width, persist = true) {
  const nextWidth = clampPanelWidth(width);
  state.panelWidth = nextWidth;
  document.documentElement.style.setProperty("--panel-width", `${nextWidth}px`);
  updatePanelResizeHandle(nextWidth);
  if (persist) savePreferences();
}

function initPanelResize() {
  let pointerId = null;
  let startX = 0;
  let startWidth = panelWidthDefaults.default;

  panelResizeHandle.addEventListener("pointerdown", (event) => {
    if (state.panelCollapsed || window.innerWidth <= panelWidthDefaults.mobileBreakpoint) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startWidth = state.panelWidth;
    panelResizeHandle.setPointerCapture(pointerId);
    document.body.classList.add("is-resizing");
    event.preventDefault();
  });

  panelResizeHandle.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) return;
    applyPanelWidth(startWidth + event.clientX - startX, false);
  });

  function finishResize(event) {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    document.body.classList.remove("is-resizing");
    savePreferences();
  }

  panelResizeHandle.addEventListener("pointerup", finishResize);
  panelResizeHandle.addEventListener("pointercancel", finishResize);

  panelResizeHandle.addEventListener("dblclick", () => {
    applyPanelWidth(panelWidthDefaults.default);
  });

  panelResizeHandle.addEventListener("keydown", (event) => {
    const steps = {
      ArrowLeft: -16,
      ArrowRight: 16,
      PageUp: 48,
      PageDown: -48,
    };

    if (event.key === "Home") {
      event.preventDefault();
      applyPanelWidth(panelWidthDefaults.min);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      applyPanelWidth(getPanelMaxWidth());
      return;
    }

    if (!Object.hasOwn(steps, event.key)) return;
    event.preventDefault();
    applyPanelWidth(state.panelWidth + steps[event.key]);
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > panelWidthDefaults.mobileBreakpoint) applyPanelWidth(state.panelWidth, false);
    else updatePanelResizeHandle(state.panelWidth);
  });
}

function setPanelCollapsed(collapsed, persist = true) {
  state.panelCollapsed = collapsed;
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  controlPanel.setAttribute("aria-label", collapsed ? "Dashboard controls collapsed" : "Dashboard controls");
  panelToggle.setAttribute("aria-expanded", String(!collapsed));
  panelToggle.setAttribute("aria-label", collapsed ? "Expand controls" : "Collapse controls");
  panelToggle.title = collapsed ? "Expand controls" : "Collapse controls";
  if (persist) savePreferences();
}

function render() {
  renderStatusFilters();
  renderQuickFilters();
  renderViewModes();
  renderSortTiers();
  renderTagFilters();
  const filtered = getBoardThreads();
  renderMetrics();
  renderUsage();
  renderBoard(filtered);
  if (state.selectedThreadId) showDetails(state.selectedThreadId);
}

async function applySnapshot(data) {
  state.threads = data.threads || [];
  state.summary = data.summary || null;
  state.usage = data.usage || null;
  state.lastSnapshotAt = data.refreshedAt || new Date().toISOString();
  render();
}

async function loadThreads() {
  refresh.disabled = true;
  try {
    const response = await fetch("/api/threads");
    applySnapshot(await response.json());
  } catch (error) {
    document.querySelector("#updatedAt").textContent = `Issue: ${error.message}`;
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
}

search.addEventListener("input", () => {
  state.query = search.value;
  savePreferences();
  render();
});

refresh.addEventListener("click", loadThreads);
panelToggle.addEventListener("click", () => setPanelCollapsed(!state.panelCollapsed));
closeDetail.addEventListener("click", closeDetails);
cardMenu.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  handleMenuAction(button.dataset.action, button).catch((error) => {
    document.querySelector("#updatedAt").textContent = `Issue: ${error.message}`;
  });
});
document.addEventListener("click", (event) => {
  if (!cardMenu.hidden && !event.target.closest("#cardMenu")) closeCardMenu();
});
document.addEventListener("scroll", closeCardMenu, true);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!cardMenu.hidden) closeCardMenu();
  if (!detailDrawer.hidden) closeDetails();
});

focusMode.addEventListener("click", () => {
  state.focusMode = !state.focusMode;
  focusMode.setAttribute("aria-pressed", String(state.focusMode));
  savePreferences();
  render();
});

hideDone.addEventListener("change", () => {
  state.hideDone = hideDone.checked;
  savePreferences();
  render();
});

sortMode.addEventListener("change", () => {
  state.sortMode = sortMode.value;
  savePreferences();
  render();
});

setInterval(() => {
  if (state.threads.length) renderMetrics();
}, 1000);

initPanelResize();
restorePreferences();
renderStatusFilters();
renderQuickFilters();
renderViewModes();
renderSortTiers();
connectEvents();
