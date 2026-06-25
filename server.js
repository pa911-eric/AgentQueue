#!/usr/bin/env node
const fsSync = require("fs");
const fs = require("fs/promises");
const path = require("path");
const http = require("http");
const { execFileSync, spawn } = require("child_process");

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch {
  DatabaseSync = null;
}

const root = __dirname;
const publicDir = path.join(root, "public");
const packageJson = readJsonFileSync(path.join(root, "package.json"), {});
const projectConfig = readJsonFileSync(path.join(root, ".agentqueue.json"), {});
const installMetadataPath = path.join(root, ".agentqueue-install.json");
const home = process.env.USERPROFILE || process.env.HOME || "";
const codexHome = process.env.CODEX_HOME || projectConfig.codexHome || path.join(home, ".codex");
const defaultRepo = packageJson.repository?.url || "https://github.com/pa911-eric/AgentQueue.git";
const cliArgs = process.argv.slice(2);
const command = cliArgs[0] && !cliArgs[0].startsWith("-") ? cliArgs[0] : "start";

const candidateIndexPaths = [
  path.join(codexHome, "session_index.jsonl"),
  path.join(codexHome, "sessions", "session_index.jsonl"),
];

const globalStatePath = path.join(codexHome, ".codex-global-state.json");
const tagsPath = path.join(codexHome, "agentqueue-tags.json");
const processManagerPath = path.join(codexHome, "process_manager", "chat_processes.json");
const sessionsRoot = path.join(codexHome, "sessions");
const stateDbPath = path.join(codexHome, "state_5.sqlite");
const goalsDbPath = path.join(codexHome, "goals_1.sqlite");
const logsDbPath = path.join(codexHome, "logs_2.sqlite");
function minutesFromEnv(name, fallback, legacyName = null) {
  const value = Number(process.env[name] ?? (legacyName ? process.env[legacyName] : undefined));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function minutesFromConfig(envName, configName, fallback, legacyName = null) {
  const configuredFallback = Number(projectConfig[configName]);
  return minutesFromEnv(
    envName,
    Number.isFinite(configuredFallback) && configuredFallback > 0 ? configuredFallback : fallback,
    legacyName
  );
}

function readJsonFileSync(filePath, fallback) {
  try {
    return JSON.parse(fsSync.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function boolFromEnv(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

function repoSlugFromUrl(value) {
  const text = String(value || "").trim();
  const match = text.match(/github\.com[/:]([^/\s]+)\/([^/\s.]+)(?:\.git)?/i);
  if (!match) return "";
  return `${match[1]}/${match[2]}`;
}

function versionParts(value) {
  return String(value || "")
    .replace(/^v/i, "")
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  const length = Math.max(left.length, right.length, 3);
  for (let index = 0; index < length; index += 1) {
    const delta = (left[index] || 0) - (right[index] || 0);
    if (delta) return delta;
  }
  return 0;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function runGit(args, options = {}) {
  return execFileSync("git", args, {
    cwd: options.cwd || root,
    encoding: "utf8",
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
  }).trim();
}

function getGitInfo() {
  try {
    const inside = runGit(["rev-parse", "--is-inside-work-tree"]);
    if (inside !== "true") return { available: true, isRepo: false };
    const remote = runGit(["remote", "get-url", "origin"]);
    const branch = runGit(["branch", "--show-current"]);
    const status = runGit(["status", "--porcelain"]);
    const commit = runGit(["rev-parse", "--short", "HEAD"]);
    return {
      available: true,
      isRepo: true,
      remote,
      repo: repoSlugFromUrl(remote),
      branch,
      dirty: Boolean(status),
      status,
      commit,
    };
  } catch (error) {
    return { available: false, isRepo: false, error: error.message };
  }
}

function expectedRepoSlug() {
  return repoSlugFromUrl(defaultRepo) || repoSlugFromUrl(getGitInfo().remote) || "pa911-eric/AgentQueue";
}

async function fetchLatestRelease(repo = expectedRepoSlug()) {
  if (!repo || boolFromEnv("AGENTQUEUE_UPDATE_CHECK_DISABLED") || boolFromEnv("AGENTQUEUE_UPDATE_CHECK", true) === false) {
    return { available: false, disabled: true };
  }

  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: {
      "accept": "application/vnd.github+json",
      "user-agent": `AgentQueue/${packageJson.version || "0.0.0"}`,
    },
  });

  if (response.status === 404) {
    return { available: false, repo, reason: "No GitHub release found" };
  }
  if (!response.ok) {
    return { available: false, repo, reason: `GitHub returned ${response.status}` };
  }

  const release = await response.json();
  const latestVersion = String(release.tag_name || "").replace(/^v/i, "");
  return {
    available: true,
    repo,
    currentVersion: packageJson.version || "0.0.0",
    latestVersion,
    latestTag: release.tag_name || latestVersion,
    updateAvailable: compareVersions(latestVersion, packageJson.version || "0.0.0") > 0,
    releaseUrl: release.html_url,
    publishedAt: release.published_at,
    name: release.name || release.tag_name || latestVersion,
  };
}

function ensureInstallMetadata() {
  if (fsSync.existsSync(installMetadataPath)) return;
  const git = getGitInfo();
  const metadata = {
    installedFrom: git.isRepo ? "github-git" : "local",
    repo: git.repo || expectedRepoSlug(),
    version: packageJson.version || "0.0.0",
    updateChannel: "stable",
    installedAt: new Date().toISOString(),
    lastUpdateCheck: null,
  };
  fsSync.writeFileSync(installMetadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

async function updateInstallMetadata(fields) {
  const current = readJsonFileSync(installMetadataPath, {});
  await fs.writeFile(installMetadataPath, `${JSON.stringify({ ...current, ...fields }, null, 2)}\n`, "utf8");
}

function openBrowser(url) {
  const platform = process.platform;
  const commandName = platform === "win32" ? "cmd" : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(commandName, args, { detached: true, stdio: "ignore" });
  child.unref();
}

const statusWindows = {
  completeMs: minutesFromConfig("AGENTQUEUE_COMPLETE_MINUTES", "completeMinutes", 10, "CODEX_THREAD_OPS_COMPLETE_MINUTES") * 60 * 1000,
  recentMs: minutesFromConfig("AGENTQUEUE_RECENT_MINUTES", "recentMinutes", 120, "CODEX_THREAD_OPS_RECENT_MINUTES") * 60 * 1000,
  runningStaleMs: minutesFromConfig("AGENTQUEUE_STALE_MINUTES", "staleMinutes", 15, "CODEX_THREAD_OPS_STALE_MINUTES") * 60 * 1000,
};

const sessionCache = new Map();
const usageCache = {
  expiresAt: 0,
  payload: null,
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendText(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  res.end(body);
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function readRequestJson(req, maxBytes = 64 * 1024) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request body is too large");
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function normalizeTag(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_.:-]/g, "")
    .toLowerCase()
    .slice(0, 40);
}

function cleanTags(tags) {
  return Array.from(new Set(
    (Array.isArray(tags) ? tags : [])
      .map(normalizeTag)
      .filter(Boolean)
  )).slice(0, 12);
}

async function readThreadTags() {
  const raw = await readJsonFile(tagsPath, {});
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const tagsByThread = {};

  for (const [threadId, tags] of Object.entries(source)) {
    if (!/^[0-9a-f-]{36}$/i.test(threadId)) continue;
    const clean = cleanTags(tags);
    if (clean.length) tagsByThread[threadId] = clean;
  }

  return tagsByThread;
}

async function writeThreadTags(tagsByThread) {
  const tempPath = `${tagsPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(tagsByThread, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, tagsPath);
}

async function setThreadTags(threadId, tags) {
  if (typeof threadId !== "string" || !/^[0-9a-f-]{36}$/i.test(threadId)) {
    throw new Error("Invalid thread id");
  }

  const tagsByThread = await readThreadTags();
  const clean = cleanTags(tags);
  if (clean.length) tagsByThread[threadId] = clean;
  else delete tagsByThread[threadId];
  await writeThreadTags(tagsByThread);
  return { threadId, tags: clean };
}

async function firstExistingPath(paths) {
  for (const filePath of paths) {
    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      // Keep looking through known Codex session index locations.
    }
  }
  return null;
}

function parseJsonLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return { id: `invalid-${index}`, thread_name: "Invalid session row", parse_error: error.message };
      }
    });
}

async function walkJsonlFiles(dir) {
  const found = [];
  async function walk(current) {
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        found.push(fullPath);
      }
    }));
  }

  await walk(dir);
  return found;
}

async function getSessionFilesById() {
  const files = await walkJsonlFiles(sessionsRoot);
  const byId = new Map();
  for (const filePath of files) {
    const match = filePath.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
    if (match) byId.set(match[1], filePath);
  }
  return byId;
}

async function readTail(filePath, maxBytes = 160 * 1024) {
  const stat = await fs.stat(filePath);
  const start = Math.max(0, stat.size - maxBytes);
  const length = stat.size - start;
  const handle = await fs.open(filePath, "r");

  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    let text = buffer.toString("utf8");
    if (start > 0) text = text.slice(text.indexOf("\n") + 1);
    return { text, stat };
  } finally {
    await handle.close();
  }
}

function summarizeSessionLines(lines) {
  const summary = {
    latestEventAt: null,
    lastMeaningfulAt: null,
    lastMeaningfulType: null,
    taskCompleteAt: null,
    finalAnswerAt: null,
    turnAbortedAt: null,
    lastAssistantPhase: null,
    lastToolName: null,
    lastUserAt: null,
    lastError: null,
    eventCount: 0,
  };

  for (const line of lines) {
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }

    summary.eventCount += 1;
    if (item.timestamp) summary.latestEventAt = item.timestamp;

    const payload = item.payload || {};
    if (payload.type === "message" && payload.role === "user") {
      summary.lastUserAt = item.timestamp;
      summary.lastMeaningfulAt = item.timestamp;
      summary.lastMeaningfulType = "user_message";
    }
    if (payload.type === "function_call") {
      summary.lastToolName = payload.name || summary.lastToolName;
      summary.lastMeaningfulAt = item.timestamp;
      summary.lastMeaningfulType = "function_call";
    }
    if (payload.type === "function_call_output") {
      summary.lastMeaningfulAt = item.timestamp;
      summary.lastMeaningfulType = "function_call_output";
    }
    if (payload.type === "message" && payload.role === "assistant") {
      summary.lastAssistantPhase = payload.phase || summary.lastAssistantPhase;
      if (payload.phase === "final_answer") summary.finalAnswerAt = item.timestamp;
      summary.lastMeaningfulAt = item.timestamp;
      summary.lastMeaningfulType = payload.phase === "final_answer" ? "final_answer" : "assistant_message";
    }
    if (item.type === "event_msg" && payload.type === "agent_message") {
      summary.lastAssistantPhase = payload.phase || summary.lastAssistantPhase;
      if (payload.phase === "final_answer") summary.finalAnswerAt = item.timestamp;
      summary.lastMeaningfulAt = item.timestamp;
      summary.lastMeaningfulType = payload.phase === "final_answer" ? "final_answer" : "agent_message";
    }
    if (item.type === "event_msg" && payload.type === "task_complete") {
      summary.taskCompleteAt = item.timestamp;
      summary.lastMeaningfulAt = item.timestamp;
      summary.lastMeaningfulType = "task_complete";
    }
    if (item.type === "event_msg" && payload.type === "turn_aborted") {
      summary.turnAbortedAt = item.timestamp;
      summary.lastMeaningfulAt = item.timestamp;
      summary.lastMeaningfulType = "turn_aborted";
    }
    if (item.type === "event_msg" && payload.type === "error") summary.lastError = payload.message || "Error event";
  }

  return summary;
}

async function readSessionSummary(filePath) {
  if (!filePath) return null;

  try {
    const stat = await fs.stat(filePath);
    const cached = sessionCache.get(filePath);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
      return cached.summary;
    }

    const tail = await readTail(filePath);
    const lines = tail.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const summary = summarizeSessionLines(lines);
    summary.filePath = filePath;
    summary.fileSize = tail.stat.size;
    summary.fileModifiedAt = tail.stat.mtime.toISOString();

    sessionCache.set(filePath, {
      size: tail.stat.size,
      mtimeMs: tail.stat.mtimeMs,
      summary,
    });

    return summary;
  } catch {
    return null;
  }
}

function parseUsageSnapshots(text) {
  const snapshots = [];

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;

    try {
      const item = JSON.parse(line);
      const payload = item.payload || {};
      const limits = payload.rate_limits;

      if (payload.type !== "token_count" || !limits) continue;
      snapshots.push({
        at: item.timestamp,
        limitId: limits.limit_id || "codex",
        planType: limits.plan_type || null,
        rateLimitReachedType: limits.rate_limit_reached_type || null,
        primary: limits.primary || null,
        secondary: limits.secondary || null,
        credits: limits.credits || null,
        individualLimit: limits.individual_limit || null,
      });
    } catch {
      // Session logs are append-only; skip incomplete or malformed lines.
    }
  }

  return snapshots;
}

function formatWindowLabel(minutes) {
  if (!minutes) return "Usage";
  if (minutes < 60) return `${minutes}m`;
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function isSameUsageWindow(limit, resetAtMs, windowMinutes) {
  if (!limit) return false;
  const limitResetAtMs = Number(limit.resets_at || 0) * 1000;
  const limitWindowMinutes = Number(limit.window_minutes || 0);
  if (windowMinutes && limitWindowMinutes && limitWindowMinutes !== windowMinutes) return false;
  if (!resetAtMs || !limitResetAtMs) return resetAtMs === limitResetAtMs;
  return Math.abs(limitResetAtMs - resetAtMs) <= 60_000;
}

function buildUsageWindow(label, latest, snapshots) {
  const current = latest?.[label];
  if (!current || typeof current.used_percent !== "number") return null;

  const resetAtMs = Number(current.resets_at || 0) * 1000;
  const windowMinutes = Number(current.window_minutes || 0);
  const usedPercent = Number(current.used_percent);
  const points = snapshots
    .map((snapshot) => {
      const limit = snapshot[label];
      if (!isSameUsageWindow(limit, resetAtMs, windowMinutes)) return null;
      return {
        at: snapshot.at,
        usedPercent: Number(limit.used_percent),
        remainingPercent: Math.max(0, 100 - Number(limit.used_percent)),
      };
    })
    .filter((point) => point && Number.isFinite(point.usedPercent))
    .sort((a, b) => new Date(a.at) - new Date(b.at));

  let maxUsedPercent = usedPercent;
  let runningUsedPercent = null;
  for (const point of points) {
    runningUsedPercent = Math.max(runningUsedPercent ?? point.usedPercent, point.usedPercent);
    maxUsedPercent = Math.max(maxUsedPercent, runningUsedPercent);
    point.usedPercent = runningUsedPercent;
    point.remainingPercent = Math.max(0, 100 - runningUsedPercent);
  }

  return {
    key: label,
    label: label === "primary" ? `Primary ${formatWindowLabel(windowMinutes)}` : `Secondary ${formatWindowLabel(windowMinutes)}`,
    usedPercent: maxUsedPercent,
    remainingPercent: Math.max(0, 100 - maxUsedPercent),
    windowMinutes,
    resetsAt: resetAtMs ? new Date(resetAtMs).toISOString() : null,
    resetInMs: resetAtMs ? Math.max(0, resetAtMs - Date.now()) : null,
    points: points.slice(-48),
  };
}

async function readUsageMetrics() {
  if (usageCache.payload && Date.now() < usageCache.expiresAt) return usageCache.payload;

  const files = await walkJsonlFiles(sessionsRoot);
  const snapshots = [];

  await Promise.all(files.map(async (filePath) => {
    try {
      const tail = await readTail(filePath, 768 * 1024);
      snapshots.push(...parseUsageSnapshots(tail.text));
    } catch {
      // Ignore inaccessible or transient session files.
    }
  }));

  snapshots.sort((a, b) => new Date(a.at) - new Date(b.at));
  const latest = snapshots.at(-1) || null;

  const payload = latest ? {
    available: true,
    refreshedAt: new Date().toISOString(),
    latestAt: latest.at,
    limitId: latest.limitId,
    planType: latest.planType,
    rateLimitReachedType: latest.rateLimitReachedType,
    primary: buildUsageWindow("primary", latest, snapshots),
    secondary: buildUsageWindow("secondary", latest, snapshots),
  } : {
    available: false,
    refreshedAt: new Date().toISOString(),
    message: "No local token_count rate limit events found.",
  };

  usageCache.payload = payload;
  usageCache.expiresAt = Date.now() + 15_000;
  return payload;
}

function processIsAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

async function readProcessRows() {
  const rows = await readJsonFile(processManagerPath, []);
  const byThread = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const conversationId = row.conversationId;
    if (!conversationId) continue;
    const list = byThread.get(conversationId) || [];
    list.push({
      command: row.command || "Command",
      osPid: row.osPid || null,
      alive: processIsAlive(row.osPid),
      startedAt: row.startedAtMs ? new Date(row.startedAtMs).toISOString() : null,
      updatedAt: row.updatedAtMs ? new Date(row.updatedAtMs).toISOString() : null,
    });
    byThread.set(conversationId, list);
  }

  return byThread;
}

function cleanPermission(value) {
  return String(value || "unknown").replace(/^:/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function epochToIso(value) {
  if (!value) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return new Date(number > 10_000_000_000 ? number : number * 1000).toISOString();
}

function stripWindowsNamespace(value) {
  return String(value || "").replace(/^\\\\\?\\/, "");
}

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseParentThreadId(source) {
  const parsed = parseJson(source, null);
  return parsed?.subagent?.thread_spawn?.parent_thread_id || null;
}

function readSqliteRows(dbPath, sql) {
  if (!DatabaseSync) return [];
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return db.prepare(sql).all();
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

function readThreadsFromSqlite() {
  return readSqliteRows(stateDbPath, `
    select id, title, preview, rollout_path, cwd, source, thread_source, agent_nickname,
           agent_role, created_at, updated_at, created_at_ms, updated_at_ms, recency_at_ms,
           archived, archived_at, sandbox_policy, approval_mode, tokens_used, git_branch,
           git_origin_url, model, reasoning_effort
    from threads
    order by coalesce(updated_at_ms, updated_at * 1000) desc
  `).map((row) => ({
    id: row.id,
    thread_name: row.title,
    preview: row.preview,
    rolloutPath: row.rollout_path,
    cwd: stripWindowsNamespace(row.cwd),
    source: row.source,
    threadSource: row.thread_source || "user",
    parentThreadId: parseParentThreadId(row.source),
    agentNickname: row.agent_nickname,
    agentRole: row.agent_role,
    createdAt: epochToIso(row.created_at_ms || row.created_at),
    updated_at: epochToIso(row.updated_at_ms || row.updated_at),
    recencyAt: epochToIso(row.recency_at_ms),
    archived: Boolean(row.archived),
    archivedAt: epochToIso(row.archived_at),
    sandboxPolicy: parseJson(row.sandbox_policy, row.sandbox_policy),
    approvalMode: row.approval_mode,
    tokensUsed: row.tokens_used || 0,
    gitBranch: row.git_branch,
    gitOriginUrl: row.git_origin_url,
    model: row.model,
    reasoningEffort: row.reasoning_effort,
  }));
}

function readThreadsFromIndex(indexText) {
  const unique = new Map();
  for (const thread of parseJsonLines(indexText)) {
    if (thread.id) unique.set(thread.id, thread);
  }
  return Array.from(unique.values());
}

function readSpawnEdges() {
  const childrenByParent = new Map();
  const parentByChild = new Map();
  for (const row of readSqliteRows(stateDbPath, "select parent_thread_id, child_thread_id, status from thread_spawn_edges")) {
    const list = childrenByParent.get(row.parent_thread_id) || [];
    list.push({ childThreadId: row.child_thread_id, status: row.status });
    childrenByParent.set(row.parent_thread_id, list);
    parentByChild.set(row.child_thread_id, { parentThreadId: row.parent_thread_id, status: row.status });
  }
  return { childrenByParent, parentByChild };
}

function readGoals() {
  const goals = new Map();
  for (const row of readSqliteRows(goalsDbPath, "select * from thread_goals")) {
    goals.set(row.thread_id, {
      status: row.status,
      tokensUsed: row.tokens_used || 0,
      tokenBudget: row.token_budget || null,
      updatedAt: epochToIso(row.updated_at_ms),
      objective: row.objective || "",
    });
  }
  return goals;
}

function readLogHealth() {
  const health = new Map();
  const rows = readSqliteRows(logsDbPath, `
    select thread_id,
           sum(case when level = 'ERROR' then 1 else 0 end) as errors_24h,
           sum(case when level = 'WARN' then 1 else 0 end) as warnings_24h,
           max(ts) as last_log_ts
    from logs
    where thread_id is not null
      and thread_id != ''
      and ts > strftime('%s','now','-24 hours')
    group by thread_id
  `);

  for (const row of rows) {
    health.set(row.thread_id, {
      errors24h: Number(row.errors_24h || 0),
      warnings24h: Number(row.warnings_24h || 0),
      lastLogAt: epochToIso(row.last_log_ts),
    });
  }

  return health;
}

function removeUnreadIdsFromMap(unreadByHost, ids) {
  if (!unreadByHost || typeof unreadByHost !== "object") return 0;
  let removed = 0;

  for (const [host, unreadIds] of Object.entries(unreadByHost)) {
    if (!Array.isArray(unreadIds)) continue;
    const next = unreadIds.filter((id) => !ids.has(id));
    removed += unreadIds.length - next.length;
    unreadByHost[host] = next;
  }

  return removed;
}

async function markThreadsRead(threadIds) {
  const ids = new Set(
    (Array.isArray(threadIds) ? threadIds : [])
      .filter((id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id))
  );

  if (ids.size === 0) return { markedIds: [], removed: 0 };

  const state = await readJsonFile(globalStatePath, {});
  const atomState = state["electron-persisted-atom-state"] || {};
  let removed = 0;

  removed += removeUnreadIdsFromMap(state["unread-thread-ids-by-host-v1"], ids);
  removed += removeUnreadIdsFromMap(atomState["unread-thread-ids-by-host-v1"], ids);

  if (removed > 0) {
    const tempPath = `${globalStatePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, globalStatePath);
  }

  return { markedIds: Array.from(ids), removed };
}

function getStatus({ activityAt, session }, now = Date.now()) {
  const activityMs = new Date(activityAt || 0).getTime();
  const taskCompleteMs = new Date(session?.taskCompleteAt || 0).getTime();
  const lastMeaningfulMs = new Date(session?.lastMeaningfulAt || session?.latestEventAt || 0).getTime();
  const hasOpenTurn = session && session.lastMeaningfulType !== "task_complete";
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  if (hasOpenTurn && lastMeaningfulMs >= startOfToday.getTime() && now - lastMeaningfulMs <= statusWindows.runningStaleMs) return "running";
  if (taskCompleteMs && now - taskCompleteMs <= statusWindows.completeMs) return "complete";
  if (activityMs && now - activityMs <= statusWindows.recentMs) return "recent";
  if (activityMs && activityMs >= startOfToday.getTime()) return "today";
  return "done";
}

function maxIso(...values) {
  const times = values
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => !Number.isNaN(value));
  if (times.length === 0) return null;
  return new Date(Math.max(...times)).toISOString();
}

function toLocalDateKey(value) {
  const date = value ? new Date(value) : new Date(0);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
}

function enrichThread(thread, context) {
  const { state, sessionFilesById, processRowsByThread, spawnEdges, goals, logHealth, tagsByThread } = context;
  const atomState = state["electron-persisted-atom-state"] || {};
  const permissionsById = state["heartbeat-thread-permissions-by-id"] || atomState["heartbeat-thread-permissions-by-id"] || {};
  const unreadByHost = state["unread-thread-ids-by-host-v1"] || atomState["unread-thread-ids-by-host-v1"] || {};
  const pinnedIds = new Set(state["pinned-thread-ids"] || atomState["pinned-thread-ids"] || []);
  const projectlessIds = new Set(state["projectless-thread-ids"] || atomState["projectless-thread-ids"] || []);
  const workspaceHints = state["thread-workspace-root-hints"] || atomState["thread-workspace-root-hints"] || {};
  const outputDirs = state["thread-projectless-output-directories"] || atomState["thread-projectless-output-directories"] || {};
  const promptHistory = atomState["prompt-history"] || state["prompt-history"] || {};
  const unreadIds = new Set(Object.values(unreadByHost).flat());
  const permissions = permissionsById[thread.id] || {};
  const processes = processRowsByThread.get(thread.id) || [];
  const liveProcesses = processes.filter((row) => row.alive);
  const session = context.sessionSummaries.get(thread.id) || null;
  const prompts = promptHistory[thread.id] || [];
  const goal = goals.get(thread.id) || null;
  const logs = logHealth.get(thread.id) || { errors24h: 0, warnings24h: 0, lastLogAt: null };
  const childThreads = spawnEdges.childrenByParent.get(thread.id) || [];
  const parent = spawnEdges.parentByChild.get(thread.id) || {};
  const parentThreadId = thread.parentThreadId || parent.parentThreadId || null;
  const activityAt = maxIso(thread.recencyAt, thread.updated_at, session?.lastMeaningfulAt, session?.latestEventAt, goal?.updatedAt, ...processes.map((row) => row.updatedAt));
  const status = getStatus({ activityAt, session });
  const latestEventMs = new Date(session?.lastMeaningfulAt || session?.latestEventAt || activityAt || 0).getTime();
  const unfinished = session && session.lastMeaningfulType !== "task_complete";
  const runningStale = unfinished && Date.now() - latestEventMs > statusWindows.runningStaleMs;
  const localSandbox = typeof thread.sandboxPolicy === "object" ? thread.sandboxPolicy?.type : thread.sandboxPolicy;
  const permissionMode = cleanPermission(permissions.activePermissionProfile?.id || permissions.sandboxPolicy?.type || localSandbox || "unknown");
  const workspace = thread.cwd || workspaceHints[thread.id] || null;
  const outputDirectory = outputDirs[thread.id] || null;

  return {
    id: thread.id,
    name: thread.thread_name || "Untitled thread",
    preview: thread.preview || thread.lastPrompt || null,
    status,
    statusLabel: status[0].toUpperCase() + status.slice(1),
    confidence: session ? (runningStale ? "stale" : "high") : "index only",
    updatedAt: thread.updated_at || null,
    activityAt,
    activityDateKey: toLocalDateKey(activityAt),
    completedAt: session?.taskCompleteAt || session?.finalAnswerAt || null,
    lastUserAt: session?.lastUserAt || null,
    runningSince: status === "running" ? (session?.lastUserAt || session?.lastMeaningfulAt || activityAt) : null,
    runningStale,
    aborted: Boolean(session?.turnAbortedAt),
    archived: Boolean(thread.archived),
    unread: unreadIds.has(thread.id),
    pinned: pinnedIds.has(thread.id),
    projectless: projectlessIds.has(thread.id),
    threadSource: thread.threadSource || "user",
    parentThreadId,
    childThreadCount: childThreads.length,
    openChildThreadCount: childThreads.filter((edge) => edge.status === "open").length,
    agentNickname: thread.agentNickname || null,
    agentRole: thread.agentRole || null,
    permissionMode,
    fullAccess: /danger|full/i.test(permissionMode),
    approvalPolicy: permissions.approvalPolicy || thread.approvalMode || "unknown",
    workspace,
    outputDirectory,
    lastPrompt: prompts.at(-1) || thread.preview || null,
    promptCount: prompts.length,
    sessionFile: thread.rolloutPath || sessionFilesById.get(thread.id) || null,
    sessionFileSize: session?.fileSize || null,
    lastToolName: session?.lastToolName || null,
    lastMeaningfulType: session?.lastMeaningfulType || null,
    lastAssistantPhase: session?.lastAssistantPhase || null,
    lastError: session?.lastError || thread.parse_error || null,
    liveProcessCount: liveProcesses.length,
    liveProcesses,
    processCount: processes.length,
    logHealth: logs,
    goal,
    tokensUsed: thread.tokensUsed || 0,
    gitBranch: thread.gitBranch || null,
    gitOriginUrl: thread.gitOriginUrl || null,
    model: thread.model || null,
    reasoningEffort: thread.reasoningEffort || null,
    tags: tagsByThread[thread.id] || [],
    codexUrl: `codex://threads/${thread.id}`,
    parseError: thread.parse_error || null,
  };
}

function computeSummary(threads, refreshedAt) {
  const counts = Object.fromEntries(["running", "complete", "recent", "today", "done"].map((key) => [key, 0]));
  for (const thread of threads) counts[thread.status] = (counts[thread.status] || 0) + 1;
  const tagCounts = {};
  for (const thread of threads) {
    for (const tag of thread.tags || []) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }

  return {
    refreshedAt,
    total: threads.length,
    counts,
    tagCounts,
    unread: threads.filter((thread) => thread.unread).length,
    liveProcesses: threads.reduce((sum, thread) => sum + thread.liveProcessCount, 0),
    liveFullAccess: threads.filter((thread) => thread.liveProcessCount && thread.fullAccess).length,
    logWarnings24h: threads.reduce((sum, thread) => sum + (thread.logHealth?.warnings24h || 0), 0),
    logErrors24h: threads.reduce((sum, thread) => sum + (thread.logHealth?.errors24h || 0), 0),
    fullAccess: threads.filter((thread) => thread.fullAccess).length,
    projectless: threads.filter((thread) => thread.projectless).length,
    subagents: threads.filter((thread) => thread.threadSource === "subagent").length,
    activeGoals: threads.filter((thread) => thread.goal?.status === "active").length,
    staleRunning: threads.filter((thread) => thread.runningStale).length,
  };
}

async function loadThreads() {
  const indexPath = await firstExistingPath(candidateIndexPaths);
  const sqliteThreads = readThreadsFromSqlite();
  if (!indexPath && sqliteThreads.length === 0) {
    return {
      indexPath: null,
      stateDbPath,
      codexHome,
      threads: [],
      summary: computeSummary([], new Date().toISOString()),
      error: `No session index found. Checked: ${candidateIndexPaths.join(", ")}`,
    };
  }

  const [indexText, state, sessionFilesById, processRowsByThread, tagsByThread] = await Promise.all([
    indexPath ? fs.readFile(indexPath, "utf8") : Promise.resolve(""),
    readJsonFile(globalStatePath, {}),
    getSessionFilesById(),
    readProcessRows(),
    readThreadTags(),
  ]);

  const threadsSource = sqliteThreads.length ? sqliteThreads : readThreadsFromIndex(indexText);
  const unique = new Map(threadsSource.map((thread) => [thread.id, thread]));
  const spawnEdges = readSpawnEdges();
  const goals = readGoals();
  const logHealth = readLogHealth();
  const usage = await readUsageMetrics();

  const sessionSummaries = new Map();
  await Promise.all(Array.from(unique.entries()).map(async ([id, thread]) => {
    sessionSummaries.set(id, await readSessionSummary(thread.rolloutPath || sessionFilesById.get(id)));
  }));

  const context = { state, sessionFilesById, processRowsByThread, sessionSummaries, spawnEdges, goals, logHealth, tagsByThread };
  const threads = Array.from(unique.values())
    .map((thread) => enrichThread(thread, context))
    .sort((a, b) => {
      const pinnedDelta = Number(b.pinned) - Number(a.pinned);
      if (pinnedDelta) return pinnedDelta;
      return new Date(b.activityAt || 0) - new Date(a.activityAt || 0);
    });

  const refreshedAt = new Date().toISOString();
  return {
    indexPath,
    stateDbPath: sqliteThreads.length ? stateDbPath : null,
    goalsDbPath: goals.size ? goalsDbPath : null,
    logsDbPath: logHealth.size ? logsDbPath : null,
    globalStatePath,
    processManagerPath,
    sessionsRoot,
    codexHome,
    statusWindows,
    refreshedAt,
    summary: computeSummary(threads, refreshedAt),
    usage,
    threads,
  };
}

async function serveStatic(res, requestPath) {
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.normalize(path.join(publicDir, safePath));

  if (!filePath.startsWith(publicDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const body = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".md": "text/markdown; charset=utf-8",
    }[ext] || "application/octet-stream";
    sendText(res, 200, body, type);
  } catch {
    sendText(res, 404, "Not found");
  }
}

async function runDoctor() {
  const rows = [];
  const add = (status, label, detail) => rows.push({ status, label, detail });
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const git = getGitInfo();

  add(nodeMajor >= 18 ? "pass" : "fail", "Node.js", `${process.version}${nodeMajor >= 24 ? " with node:sqlite support" : " without stable node:sqlite support"}`);
  add(DatabaseSync ? "pass" : "warn", "SQLite inventory", DatabaseSync ? "node:sqlite is available" : "Node 24+ recommended for Codex SQLite inventory reads");
  add(fsSync.existsSync(codexHome) ? "pass" : "fail", "CODEX_HOME", codexHome);
  add(candidateIndexPaths.some((filePath) => fsSync.existsSync(filePath)) || fsSync.existsSync(stateDbPath) ? "pass" : "warn", "Thread inventory", "session_index.jsonl or state_5.sqlite");
  add(fsSync.existsSync(sessionsRoot) ? "pass" : "warn", "Sessions directory", sessionsRoot);
  add(git.available ? "pass" : "warn", "Git", git.available ? "git command is available" : git.error || "git unavailable");
  add(git.isRepo ? "pass" : "warn", "Install type", git.isRepo ? `git clone on ${git.branch || "detached"} @ ${git.commit}` : "not a git checkout");
  if (git.isRepo) {
    add(git.dirty ? "warn" : "pass", "Local changes", git.dirty ? "working tree has local changes; update will stop" : "working tree clean");
    add(git.repo === expectedRepoSlug() ? "pass" : "warn", "GitHub remote", git.remote || "missing origin remote");
  }

  try {
    const release = await fetchLatestRelease(git.repo || expectedRepoSlug());
    await updateInstallMetadata({ lastUpdateCheck: new Date().toISOString(), repo: release.repo || git.repo || expectedRepoSlug() });
    if (release.available) {
      add(release.updateAvailable ? "warn" : "pass", "Latest release", release.updateAvailable ? `${release.latestTag} available; current ${release.currentVersion}` : `current ${release.currentVersion}`);
    } else {
      add("warn", "Latest release", release.reason || "update check disabled");
    }
  } catch (error) {
    add("warn", "Latest release", error.message);
  }

  console.log("AgentQueue doctor\n");
  for (const row of rows) {
    const mark = row.status === "pass" ? "PASS" : row.status === "fail" ? "FAIL" : "WARN";
    console.log(`[${mark}] ${row.label}: ${row.detail}`);
  }
  const failed = rows.some((row) => row.status === "fail");
  process.exitCode = failed ? 1 : 0;
}

function runUpdate() {
  const git = getGitInfo();
  console.log("AgentQueue update\n");
  if (!git.available) {
    console.error(`Git is unavailable: ${git.error || "unknown error"}`);
    process.exitCode = 1;
    return;
  }
  if (!git.isRepo) {
    console.error("This install is not a git checkout. Download the latest GitHub release zip instead.");
    process.exitCode = 1;
    return;
  }
  if (git.repo !== expectedRepoSlug()) {
    console.error(`Refusing to update from unexpected remote: ${git.remote}`);
    console.error(`Expected GitHub repo: ${expectedRepoSlug()}`);
    process.exitCode = 1;
    return;
  }
  if (git.dirty) {
    console.error("Refusing to update because the working tree has local changes.");
    console.error("Commit, stash, or move those changes first, then run npm run update again.");
    process.exitCode = 1;
    return;
  }

  console.log(`Remote: ${git.remote}`);
  console.log(`Current: ${packageJson.version || "0.0.0"} @ ${git.commit}`);
  execFileSync("git", ["pull", "--ff-only"], { cwd: root, stdio: "inherit" });
  const nextVersion = readJsonFileSync(path.join(root, "package.json"), {}).version || "0.0.0";
  fsSync.writeFileSync(installMetadataPath, `${JSON.stringify({
    ...readJsonFileSync(installMetadataPath, {}),
    installedFrom: "github-git",
    repo: git.repo,
    version: nextVersion,
    lastUpdatedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
  console.log(`\nAgentQueue is updated to ${nextVersion}. Run npm start to launch.`);
}

async function runUpdateCheck() {
  const git = getGitInfo();
  const release = await fetchLatestRelease(git.repo || expectedRepoSlug());
  await updateInstallMetadata({ lastUpdateCheck: new Date().toISOString(), repo: release.repo || git.repo || expectedRepoSlug() });
  if (!release.available) {
    console.log(release.reason || "No release information available.");
    return;
  }
  console.log(`Current: ${release.currentVersion}`);
  console.log(`Latest:  ${release.latestTag}`);
  console.log(release.updateAvailable ? `Update available: ${release.releaseUrl}` : "AgentQueue is current.");
}

async function renderHealthPage() {
  const git = getGitInfo();
  const release = await fetchLatestRelease(git.repo || expectedRepoSlug()).catch((error) => ({ available: false, reason: error.message }));
  const rows = [
    ["Version", packageJson.version || "0.0.0"],
    ["Node", process.version],
    ["CODEX_HOME", codexHome],
    ["SQLite", DatabaseSync ? "available" : "unavailable; Node 24+ recommended"],
    ["Git install", git.isRepo ? `${git.repo} ${git.dirty ? "(local changes)" : "(clean)"}` : "not a git checkout"],
    ["Latest release", release.available ? `${release.latestTag}${release.updateAvailable ? " available" : " current"}` : release.reason || "unknown"],
  ];
  return `<!doctype html><html><head><meta charset="utf-8"><title>AgentQueue Health</title><style>body{font-family:Inter,system-ui,sans-serif;margin:24px;background:#f8fafc;color:#0f172a}main{max-width:820px}table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e2e8f0}td{padding:10px 12px;border-bottom:1px solid #e2e8f0}td:first-child{font-weight:700;color:#475569;width:180px}code{font-family:Consolas,monospace}</style></head><body><main><h1>AgentQueue Health</h1><table>${rows.map(([label, detail]) => `<tr><td>${label}</td><td><code>${escapeHtml(detail)}</code></td></tr>`).join("")}</table></main></body></html>`;
}

async function sendEvent(res) {
  const payload = await loadThreads();
  res.write(`event: snapshot\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  try {
    if (url.pathname === "/api/threads") {
      sendJson(res, 200, await loadThreads());
      return;
    }

    if (url.pathname === "/api/threads/read") {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method not allowed" });
        return;
      }

      const body = await readRequestJson(req);
      sendJson(res, 200, { ok: true, ...(await markThreadsRead(body.threadIds)) });
      return;
    }

    if (url.pathname === "/api/threads/tags") {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method not allowed" });
        return;
      }

      const body = await readRequestJson(req);
      sendJson(res, 200, { ok: true, ...(await setThreadTags(body.threadId, body.tags)) });
      return;
    }

    if (url.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        version: packageJson.version || "0.0.0",
        codexHome,
        node: process.version,
        sqlite: Boolean(DatabaseSync),
        git: getGitInfo(),
        now: new Date().toISOString(),
      });
      return;
    }

    if (url.pathname === "/api/update-check") {
      const git = getGitInfo();
      const release = await fetchLatestRelease(git.repo || expectedRepoSlug());
      await updateInstallMetadata({ lastUpdateCheck: new Date().toISOString(), repo: release.repo || git.repo || expectedRepoSlug() });
      sendJson(res, 200, { ...release, gitInstall: Boolean(git.isRepo), dirty: Boolean(git.dirty) });
      return;
    }

    if (url.pathname === "/api/usage") {
      sendJson(res, 200, await readUsageMetrics());
      return;
    }

    if (url.pathname === "/health") {
      sendText(res, 200, await renderHealthPage(), "text/html; charset=utf-8");
      return;
    }

    if (url.pathname === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });
      await sendEvent(res);
      const timer = setInterval(() => {
        sendEvent(res).catch((error) => {
          res.write(`event: error\n`);
          res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        });
      }, 3000);
      req.on("close", () => clearInterval(timer));
      return;
    }

    await serveStatic(res, url.pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

function listen(port, attemptsLeft = 12) {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
      listen(port + 1, attemptsLeft - 1);
      return;
    }
    throw error;
  });

  server.listen(port, () => {
    const address = server.address();
    const url = `http://localhost:${address.port}`;
    console.log(`AgentQueue running at ${url}`);
    const shouldOpen = cliArgs.includes("--open") || boolFromEnv("AGENTQUEUE_OPEN", Boolean(projectConfig.openBrowser));
    if (shouldOpen) openBrowser(url);
  });
}

async function main() {
  ensureInstallMetadata();
  if (command === "doctor") {
    await runDoctor();
    return;
  }
  if (command === "update") {
    runUpdate();
    return;
  }
  if (command === "update-check" || command === "check-updates") {
    await runUpdateCheck();
    return;
  }
  if (command !== "start") {
    console.error(`Unknown command: ${command}`);
    console.error("Use: start, doctor, update, or update-check");
    process.exitCode = 1;
    return;
  }

  listen(Number(process.env.PORT || projectConfig.port || 4173));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
