import { accountKey, classifyAccountHealth, inactiveAccountIds } from "./account-health.js";

const app = document.querySelector("#app");
const APP_VERSION = "v2.1.0";

const state = {
  accounts: [],
  selectedId: null,
  foldersByAccount: {},
  selectedFolderByAccount: {},
  refreshStateByAccount: {},
  selectedAccountIds: [],
  messages: [],
  fetchedAt: "",
  unreadCount: null,
  busy: false,
  folderBusy: false,
  batchBusy: false,
  batchProgress: { done: 0, total: 0 },
  actionsExpanded: false,
  importExpanded: false,
  importBusy: false,
  sidebarCollapsed: false,
  sites: [],
  siteBusy: false,
  accountBusy: false,
  codeBusy: false,
  tokenBusy: false,
  tokenStatus: null,
  accountSort: "email",
  accountQuery: "",
  pendingDelete: null,
  sidebarScrollTop: 0,
  toast: "",
};

function loadSetting(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function saveSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Browser settings are optional convenience state.
  }
}

state.linkOpenMode = loadSetting("linkOpenMode", "private");
state.messageRenderMode = loadSetting("messageRenderMode", "html");
state.theme = loadSetting("theme", "light");
state.shortcutsOpen = false;
state.statusFilter = "all";

function applyTheme() {
  const dark = state.theme === "dark";
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#171b23" : "#ffffff");
}
applyTheme();

function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  saveSetting("theme", state.theme);
  applyTheme();
  render();
}

async function api(path, options = {}) {
  const timeoutMs = options.timeoutMs || 65_000;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const externalSignal = options.signal;
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onExternalAbort);
  }
  let response;
  try {
    response = await fetch(path, {
      ...options,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    if (error.name === "AbortError") {
      if (externalSignal?.aborted) throw new Error("已取消。");
      throw new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒），请稍后重试。`);
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `请求失败：${response.status}`);
    error.failure = body.failure || null;
    throw error;
  }
  return body;
}

function html(strings, ...values) {
  return strings.reduce((result, string, index) => result + string + (values[index] ?? ""), "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "暂无";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function preserveSidebarScroll(task) {
  const sidebar = document.querySelector(".sidebar");
  const scrollTop = sidebar?.scrollTop ?? state.sidebarScrollTop;
  state.sidebarScrollTop = scrollTop;
  task();
  restoreSidebarScroll();
}

function restoreSidebarScroll() {
  const sidebar = document.querySelector(".sidebar");
  if (!sidebar) return;
  sidebar.scrollTop = state.sidebarScrollTop;
  window.requestAnimationFrame(() => {
    const nextSidebar = document.querySelector(".sidebar");
    if (nextSidebar) nextSidebar.scrollTop = state.sidebarScrollTop;
  });
}

async function copyText(text, successMessage) {
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    copied = document.execCommand("copy");
    textarea.remove();
  }
  toast(copied ? successMessage : `复制失败，请手动复制：${text}`);
}

function toast(message) {
  state.toast = message;
  render();
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => {
    state.toast = "";
    render();
  }, 3600);
}

function selectedAccount() {
  return state.accounts.find((account) => account.id === state.selectedId) || null;
}

function hasAccount(id) {
  return state.accounts.some((account) => account.id === id);
}

function selectAccountById(id) {
  if (state.accountBusy || !hasAccount(id)) return;
  preserveSidebarScroll(() => {
    state.selectedId = id;
    const refresh = accountRefreshState(id);
    state.messages = refresh.status === "ok" ? refresh.messages || [] : [];
    state.fetchedAt = refresh.fetchedAt || "";
    state.unreadCount = refresh.unreadCount ?? null;
    render();
  });
  loadFolders(id, false);
}

function moveAccountSelection(delta) {
  const list = sortedAccounts();
  if (!list.length) return;
  const currentIndex = list.findIndex((account) => account.id === state.selectedId);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + delta + list.length) % list.length;
  selectAccountById(list[nextIndex].id);
  document.querySelector(`.account-row.active`)?.scrollIntoView({ block: "nearest" });
}

function accountCountLabel() {
  const total = state.accounts.length;
  const shown = filteredAccountList().length;
  if (shown === total) return `${total} 个账号`;
  return `${shown} / ${total} 个账号`;
}

function accountHealthType(account, tokenByEmail = tokenStatusByEmail()) {
  return accountLifeStatus(account, accountRefreshState(account.id), tokenByEmail).type;
}

function statusFilterCounts() {
  const tokenByEmail = tokenStatusByEmail();
  const counts = { all: state.accounts.length, alive: 0, error: 0, checking: 0, pending: 0 };
  for (const account of state.accounts) {
    const type = accountHealthType(account, tokenByEmail);
    if (counts[type] != null) counts[type] += 1;
  }
  return counts;
}

function filteredAccountList() {
  const query = state.accountQuery.trim().toLowerCase();
  const status = state.statusFilter;
  const tokenByEmail = status === "all" ? null : tokenStatusByEmail();
  return state.accounts.filter((account) => {
    if (query) {
      const site = (account.siteIds || [])
        .map((id) => state.sites.find((s) => s.id === id)?.name || "")
        .join(" ");
      if (!`${account.email} ${account.clientId || ""} ${site}`.toLowerCase().includes(query)) return false;
    }
    if (status !== "all" && accountHealthType(account, tokenByEmail) !== status) return false;
    return true;
  });
}

function sortedAccounts() {
  const accounts = [...filteredAccountList()];
  if (state.accountSort === "imported") {
    return accounts.sort((a, b) => {
      const importedDiff = new Date(b.importedAt || b.updatedAt || 0) - new Date(a.importedAt || a.updatedAt || 0);
      return importedDiff || a.email.localeCompare(b.email, "en", { sensitivity: "base" });
    });
  }
  return accounts.sort((a, b) => a.email.localeCompare(b.email, "en", { sensitivity: "base" }));
}

function selectedFolder(id = state.selectedId) {
  return state.selectedFolderByAccount[id] || "INBOX";
}

function accountRefreshState(id) {
  return state.refreshStateByAccount[id] || { status: "idle" };
}

function selectedAccountSet() {
  return new Set((state.selectedAccountIds || []).map((id) => String(id)));
}

function isAccountSelected(id) {
  return selectedAccountSet().has(String(id));
}

function setAccountSelection(ids) {
  state.selectedAccountIds = [...new Set((ids || []).map((id) => String(id)))];
}

function toggleAccountSelection(id) {
  if (accountSelectionBusy()) return;
  const next = selectedAccountSet();
  const key = String(id);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  setAccountSelection([...next]);
}

function toggleAllAccountSelection() {
  if (!state.accounts.length || accountSelectionBusy()) return;
  const allSelected = state.selectedAccountIds.length === state.accounts.length;
  setAccountSelection(allSelected ? [] : state.accounts.map((account) => account.id));
  render();
}

function pruneSelectedAccounts() {
  const existing = new Set(state.accounts.map((account) => account.id));
  setAccountSelection((state.selectedAccountIds || []).filter((id) => existing.has(id)));
}

function tokenDetectionRunning() {
  return state.tokenBusy || Boolean(state.tokenStatus?.running);
}

function accountSelectionBusy() {
  return state.accountBusy || state.batchBusy || state.busy || state.folderBusy || state.importBusy || state.siteBusy || tokenDetectionRunning() || state.codeBusy;
}

function currentTokenResults() {
  return state.tokenStatus?.accountResults || state.tokenStatus?.lastSummary?.accountResults || [];
}

function tokenStatusByEmail() {
  const results = currentTokenResults();
  return new Map(results.map((result) => [accountKey(result.email), result]));
}

function inactiveAccountIdList() {
  return inactiveAccountIds(state.accounts, state.refreshStateByAccount, currentTokenResults(), {
    checking: tokenDetectionRunning(),
  });
}

function accountLifeStatus(account, refresh, tokenByEmail = tokenStatusByEmail()) {
  const token = tokenByEmail.get(accountKey(account.email));
  const health = classifyAccountHealth({
    refresh,
    token,
    checking: tokenDetectionRunning(),
  });
  if (health === "inactive" || health === "error") {
    const refreshTime = Date.parse(refresh.fetchedAt || "") || 0;
    const tokenTime = Date.parse(token?.checkedAt || "") || 0;
    const detail = tokenTime > refreshTime ? token?.error : refresh.error || token?.error;
    return {
      type: "error",
      label: health === "inactive" ? "失活" : "异常",
      detail: detail || (health === "inactive" ? "凭证已失效或账号不可用" : "检测失败"),
    };
  }
  if (health === "checking") {
    return {
      type: "checking",
      label: "检测中",
      detail: refresh.status === "queued" ? `等待刷新 ${refresh.folder || "INBOX"}` : "正在检测邮箱状态",
    };
  }
  if (health === "alive" && refresh.status === "ok") {
    return {
      type: "alive",
      label: "可用",
      detail: `${refresh.folder || "INBOX"} · 未读 ${Number.isFinite(refresh.unreadCount) ? refresh.unreadCount : "暂无"} · ${formatDate(refresh.fetchedAt)}`,
    };
  }
  if (token?.ok) {
    return {
      type: "alive",
      label: "可用",
      detail: `Token 保活通过 · ${formatDate(token.checkedAt)}`,
    };
  }
  return {
    type: "pending",
    label: "待检测",
    detail: "尚未读取邮箱或刷新 token",
  };
}

function findLatestCode(messages) {
  for (const message of messages || []) {
    const code = (message.codes || []).find((entry) => entry.type === "code");
    if (code) return { message, code };
  }
  return null;
}

async function boot() {
  const [accountsData, sitesData] = await Promise.all([api("/api/accounts"), api("/api/sites")]);
  state.accounts = accountsData.accounts || [];
  state.sites = sitesData.sites || [];
  state.selectedId = state.accounts[0]?.id || null;
  render();
  if (state.selectedId) loadFolders(state.selectedId, false);
  loadTokenStatus();
}

function render() {
  const sidebar = document.querySelector(".sidebar");
  if (sidebar) state.sidebarScrollTop = sidebar.scrollTop;
  const account = selectedAccount();
  const accounts = sortedAccounts();
  const tokenByEmail = tokenStatusByEmail();
  app.innerHTML = html`
    <div class="app-shell ${state.sidebarCollapsed ? "sidebar-collapsed" : ""}">
      <a class="skip-link" href="#main-content">跳到主要内容</a>
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">
            <img src="/app-icon.png" alt="" width="24" height="24" />
          </div>
          <div>
            <h1>邮箱聚合平台</h1>
          </div>
          <span class="version-badge">${APP_VERSION}</span>
        </div>
        <div class="topbar-actions">
          <button id="show-shortcuts" class="icon-button" aria-label="键盘快捷键" title="键盘快捷键 (?)">
            ${icon("keyboard")}
          </button>
          <button id="toggle-theme" class="icon-button" aria-label="${state.theme === "dark" ? "切换到浅色" : "切换到深色"}" title="${state.theme === "dark" ? "切换到浅色" : "切换到深色"}">
            ${icon(state.theme === "dark" ? "sun" : "moon")}
          </button>
          <button id="toggle-actions" class="icon-button primary" aria-label="${state.actionsExpanded ? "收起账号操作" : "展开账号操作"}" title="${state.actionsExpanded ? "收起账号操作" : "展开账号操作"}" aria-expanded="${state.actionsExpanded ? "true" : "false"}">
            ${icon("settings")}
          </button>
        </div>
      </header>
      ${renderActionsPanel(account)}
      <main class="layout" id="main-content" tabindex="-1">
        <aside class="sidebar">
          <div class="section-title">
            <div>
              <h2>账号列表</h2>
              <span class="muted tiny">${accountCountLabel()}</span>
            </div>
            <button id="toggle-sidebar" class="icon-button" aria-label="${state.sidebarCollapsed ? "展开账号列表" : "收起账号列表"}" title="${state.sidebarCollapsed ? "展开账号列表" : "收起账号列表"}" aria-expanded="${state.sidebarCollapsed ? "false" : "true"}">
              ${icon(state.sidebarCollapsed ? "panel-open" : "panel-close")}
            </button>
          </div>
          <div class="account-search">
            <input id="account-search" name="account-search" type="search" placeholder="搜索邮箱、client_id、网站标记…" value="${escapeHtml(state.accountQuery)}" autocomplete="off" spellcheck="false" aria-label="搜索账号" />
          </div>
          ${renderStatusFilter()}
          <div class="account-sort">
            <label for="account-sort">排序</label>
            <select id="account-sort">
              <option value="email" ${state.accountSort === "email" ? "selected" : ""}>按字母</option>
              <option value="imported" ${state.accountSort === "imported" ? "selected" : ""}>按导入时间</option>
            </select>
          </div>
          ${renderAccountBatchBar()}
          <div class="account-list">
            ${accounts.length
              ? accounts.map((row, index) => renderAccountRow(row, index, tokenByEmail)).join("")
              : state.accounts.length
                ? `<div class="empty compact">没有匹配当前筛选条件的账号。<button id="clear-account-filters" class="link-button">清除筛选</button></div>`
                : `<div class="empty compact">暂无账号。展开账号操作后添加账号。</div>`}
          </div>
        </aside>
        <section class="content">
          <div class="stack">
            ${account ? renderMailPanel(account) : renderEmptyPanel()}
          </div>
        </section>
      </main>
      ${renderDeleteModal()}
      ${renderShortcutsModal()}
      ${state.toast ? `<div class="toast" role="status" aria-live="polite">${escapeHtml(state.toast)}</div>` : ""}
    </div>
  `;
  bindEvents();
  restoreSidebarScroll();
}

function renderDeleteModal() {
  const pending = state.pendingDelete;
  if (!pending) return "";
  const { ids, accountLabel, emails } = pending;
  const shown = emails.slice(0, 8);
  const rest = emails.length - shown.length;
  return html`
    <div class="modal-backdrop" id="delete-backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title">
        <h3 id="delete-title">删除 ${ids.length} 个${escapeHtml(accountLabel)}？</h3>
        <p class="muted tiny">此操作将永久移除以下账号的本地凭证，不可恢复。</p>
        <div class="modal-list">
          ${shown.map((email) => `<div>${escapeHtml(email)}</div>`).join("")}
          ${rest > 0 ? `<div class="muted">…及其余 ${rest} 个</div>` : ""}
        </div>
        <div class="modal-actions">
          <button id="delete-cancel">取消</button>
          <button id="delete-confirm" class="danger primary">删除 ${ids.length} 个</button>
        </div>
      </div>
    </div>
  `;
}

function renderStatusFilter() {
  if (!state.accounts.length) return "";
  const counts = statusFilterCounts();
  const segs = [
    { key: "all", label: "全部", tone: "" },
    { key: "alive", label: "可用", tone: "alive" },
    { key: "error", label: "异常", tone: "error" },
    { key: "checking", label: "检测中", tone: "checking" },
    { key: "pending", label: "待检测", tone: "pending" },
  ];
  return html`
    <div class="status-filter" role="tablist" aria-label="按账号状态筛选">
      ${segs
        .filter((seg) => seg.key === "all" || counts[seg.key] > 0 || state.statusFilter === seg.key)
        .map(
          (seg) => `
            <button class="status-seg ${state.statusFilter === seg.key ? "active" : ""}" role="tab" aria-selected="${state.statusFilter === seg.key}" data-status-filter="${seg.key}">
              ${seg.tone ? `<span class="seg-dot ${seg.tone}" aria-hidden="true"></span>` : ""}
              ${seg.label}<span class="seg-count">${counts[seg.key] ?? 0}</span>
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderAccountBatchBar() {
  const selectedCount = state.selectedAccountIds.length;
  const inactiveCount = inactiveAccountIdList().length;
  const allSelected = Boolean(state.accounts.length && selectedCount === state.accounts.length);
  const busy = accountSelectionBusy();
  return html`
    <div class="account-batch-bar" role="toolbar" aria-label="批量账号操作">
      <span class="account-batch-count" aria-live="polite">已选 ${selectedCount} 个 · 失活 ${inactiveCount} 个</span>
      <div class="account-batch-actions">
        <button id="detect-inactive-accounts" class="small-button" ${!state.accounts.length || busy ? "disabled" : ""} title="检测凭证失效、账号禁用或账号不存在">
          ${tokenDetectionRunning() ? "检测中" : "检测失活"}
        </button>
        <button id="delete-inactive-accounts" class="danger small-button" ${!inactiveCount || busy ? "disabled" : ""} title="仅删除明确失活的账号">
          删除失活${inactiveCount ? ` (${inactiveCount})` : ""}
        </button>
        <button id="select-all-accounts" class="small-button" ${!state.accounts.length || busy ? "disabled" : ""}>
          ${allSelected ? "清空" : "全选"}
        </button>
        <button id="delete-selected-accounts" class="danger small-button" ${!selectedCount || busy ? "disabled" : ""}>
          删除${selectedCount ? ` (${selectedCount})` : ""}
        </button>
      </div>
    </div>
  `;
}

function renderAccountRow(account, index, tokenByEmail = tokenStatusByEmail()) {
  const refresh = accountRefreshState(account.id);
  const life = accountLifeStatus(account, refresh, tokenByEmail);
  const latestCode = refresh.status === "ok" ? findLatestCode(refresh.messages) : null;
  const clientIdShort = account.clientId ? `${account.clientId.slice(0, 8)}…` : "无 client_id";
  const accountMetaTitle = `client_id ${account.clientId || "暂无"} · 导入 ${formatDate(account.importedAt || account.updatedAt)} · 更新 ${formatDate(account.updatedAt)}`;
  return html`
    <div class="account-row status-${life.type} ${account.id === state.selectedId ? "active" : ""} ${isAccountSelected(account.id) ? "selected" : ""}" role="group" aria-label="账号 ${escapeHtml(account.email)}">
      <label class="account-select">
        <input type="checkbox" data-account-check="${account.id}" ${isAccountSelected(account.id) ? "checked" : ""} ${accountSelectionBusy() ? "disabled" : ""} aria-label="选择 ${escapeHtml(account.email)}" />
      </label>
      <button class="account-open" data-select="${account.id}" aria-label="打开 ${escapeHtml(account.email)}" ${state.accountBusy ? "disabled" : ""}>
        <span class="account-index">${String(index + 1).padStart(2, "0")}</span>
        <div class="account-row-body">
          <div class="account-main">
            <span class="account-email">${escapeHtml(account.email)}</span>
            <span class="account-main-tags">
              ${latestCode ? `<span class="badge code-flag" title="发现验证码 ${escapeHtml(latestCode.code.value)}">${icon("key")}验证码</span>` : ""}
              <span class="life-pill ${life.type}">
                <span class="life-dot" aria-hidden="true"></span>
                ${life.label}
              </span>
            </span>
          </div>
          <div class="account-life-detail ${life.type === "error" ? "error-text" : ""}">${escapeHtml(life.detail)}</div>
          <div class="account-meta" title="${escapeHtml(accountMetaTitle)}">
            <span translate="no">${escapeHtml(clientIdShort)}</span>
            <span>更新 ${formatDate(account.updatedAt)}</span>
            ${Number.isFinite(refresh.unreadCount) ? `<span class="account-meta-unread">未读 ${refresh.unreadCount}</span>` : ""}
          </div>
        </div>
      </button>
      ${state.sites.length ? `<div class="account-row-sites">${renderSiteDots(account)}</div>` : ""}
    </div>
  `;
}

function renderSiteDots(account) {
  if (!state.sites.length) return "";
  const marked = new Set(account.siteIds || []);
  return html`
    <div class="site-dot-row" aria-label="网站标记">
      ${state.sites
        .map((site) => {
          const active = marked.has(site.id);
          return `
            <button
              class="site-chip ${active ? "active" : ""}"
              data-site-toggle="${account.id}"
              data-site-id="${site.id}"
              aria-label="${escapeHtml(account.email)} ${active ? "取消" : "标记"} ${escapeHtml(site.name)}"
              title="${escapeHtml(site.name)}：${active ? "已标记，点击取消" : "未标记，点击标记"}"
              ${state.accountBusy || state.siteBusy ? "disabled" : ""}
            >
              <span class="site-dot" aria-hidden="true"></span>
              <span class="site-name">${escapeHtml(site.name)}</span>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderActionsPanel(account) {
  if (!state.actionsExpanded) return "";
  const inactiveCount = inactiveAccountIdList().length;
  const accountBusy = accountSelectionBusy();
  return html`
    <section class="actions-panel">
      <div class="actions-row">
        <button id="reload-accounts" ${state.accountBusy ? "disabled" : ""}>重新加载账号</button>
        <button id="restart-app" ${state.accountBusy ? "disabled" : ""}>重启应用</button>
        <button id="detect-inactive-accounts-top" ${!state.accounts.length || accountBusy ? "disabled" : ""} title="检测凭证失效、账号禁用或账号不存在">
          ${tokenDetectionRunning() ? "检测中" : "检测失活"}
        </button>
        <button id="delete-inactive-accounts-top" class="danger" ${!inactiveCount || accountBusy ? "disabled" : ""} title="仅删除明确失活的账号">
          删除失活${inactiveCount ? ` (${inactiveCount})` : ""}
        </button>
        <button id="refresh-all" ${!state.accounts.length || state.batchBusy || state.busy || state.accountBusy ? "disabled" : ""}>
          ${state.batchBusy ? `批量刷新 ${state.batchProgress.done}/${state.batchProgress.total}` : "批量刷新全部"}
        </button>
        <button id="fetch-selected" class="primary" ${!account || state.busy || state.batchBusy || state.accountBusy ? "disabled" : ""}>
          ${state.busy ? "读取中" : "读取最后 3 封"}
        </button>
        <button id="refresh-tokens" ${!state.accounts.length || state.tokenBusy || state.accountBusy ? "disabled" : ""}>
          ${state.tokenBusy ? "保活中" : "刷新 refresh token"}
        </button>
        ${renderTokenStatus()}
      </div>
      <div class="settings-row">
        <label>
          链接打开
          <select id="link-open-mode">
            <option value="private" ${state.linkOpenMode === "private" ? "selected" : ""}>默认无痕</option>
            <option value="normal" ${state.linkOpenMode === "normal" ? "selected" : ""}>默认普通</option>
          </select>
        </label>
        <label>
          邮件显示
          <select id="message-render-mode">
            <option value="html" ${state.messageRenderMode === "html" ? "selected" : ""}>完整 HTML / 图像</option>
            <option value="text" ${state.messageRenderMode === "text" ? "selected" : ""}>纯文本</option>
          </select>
        </label>
      </div>
      <div class="import-box">
        <div class="collapsible-header">
          <div>
            <h2>导入凭证</h2>
            <p class="muted tiny">支持 CSV，或 email----标识----client_id----refresh_token</p>
          </div>
          <button id="toggle-import" class="icon-button" aria-label="${state.importExpanded ? "收起导入凭证" : "展开导入凭证"}" title="${state.importExpanded ? "收起" : "展开"}" aria-expanded="${state.importExpanded ? "true" : "false"}">
            ${icon(state.importExpanded ? "chevron-up" : "chevron-down")}
          </button>
        </div>
        ${state.importExpanded
          ? `
            <div class="import-body">
              <textarea id="csv-input" name="oauth-credentials" aria-label="OAuth2 凭证" autocomplete="off" spellcheck="false" placeholder="email----标识----client_id----refresh_token
user@example.com----note----xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx----0.A..."></textarea>
              <div class="import-actions">
                <div id="import-result" class="muted tiny"></div>
                <button id="import-csv" class="primary" ${state.importBusy || state.accountBusy ? "disabled" : ""}>
                  ${state.importBusy ? "写入中" : "写入 SQLite"}
                </button>
              </div>
            </div>
          `
          : ""}
      </div>
      <div class="site-box">
        <div>
          <h2>网站标记</h2>
          <p class="muted tiny">输入自定义网站后，会出现在每个邮箱旁边的小圆圈里。</p>
        </div>
        <form id="site-form" class="site-form">
          <input id="site-input" name="site-name" type="text" placeholder="例如 github.com、amazon、paypal…" autocomplete="off" spellcheck="false" aria-label="网站名称" />
          <button class="primary" ${state.siteBusy ? "disabled" : ""}>${state.siteBusy ? "添加中" : "加入列表"}</button>
        </form>
        ${renderSiteList()}
      </div>
    </section>
  `;
}

function renderSiteList() {
  if (!state.sites.length) return `<div class="empty compact">暂无网站。添加后可在账号旁边标记。</div>`;
  return html`
    <div class="site-list">
      ${state.sites
        .map(
          (site) => `
            <div class="site-list-item">
              <span><i class="site-dot active" aria-hidden="true"></i>${escapeHtml(site.name)}</span>
              <button class="danger small-button" data-site-delete="${site.id}" ${state.siteBusy ? "disabled" : ""}>删除</button>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderTokenStatus() {
  const status = state.tokenStatus;
  if (!status?.lastSummary && !status?.running && !state.tokenBusy) return "";
  if (status?.running || state.tokenBusy) {
    return html`
      <span class="token-health checking">
        <span class="life-dot" aria-hidden="true"></span>
        refresh token 保活运行中
      </span>
    `;
  }
  const summary = status.lastSummary || {};
  const failed = summary.failed || 0;
  const total = summary.total || 0;
  const refreshed = summary.refreshed || 0;
  const rotated = summary.rotated || 0;
  return html`
    <span class="token-health ${failed ? "error" : "alive"}">
      <span class="life-dot" aria-hidden="true"></span>
      token 保活：${refreshed}/${total} 成功，轮换 ${rotated}，失败 ${failed}
    </span>
  `;
}

function renderEmptyPanel() {
  return html`
    <section class="panel">
      <div class="mail-empty-state">
        <div class="mail-empty-icon" aria-hidden="true">${icon("inbox")}</div>
        <div>
          <h3>还没有邮箱账号</h3>
          <p>先导入 Outlook 或 Hotmail OAuth2 凭证，之后即可读取邮件与验证码。</p>
        </div>
        <button id="empty-open-actions" class="primary">导入第一个账号</button>
      </div>
    </section>
  `;
}

function renderShortcutsModal() {
  if (!state.shortcutsOpen) return "";
  const rows = [
    ["J / ↓", "选中下一个账号"],
    ["K / ↑", "选中上一个账号"],
    ["Enter", "读取选中账号最近邮件"],
    ["/", "聚焦搜索框"],
    ["R", "刷新当前账号"],
    ["W", "等待验证码"],
    ["A", "展开 / 收起账号操作"],
    ["D", "切换深色 / 浅色"],
    ["Esc", "关闭弹窗 / 清空搜索"],
    ["?", "打开本快捷键面板"],
  ];
  return html`
    <div class="modal-backdrop" id="shortcuts-backdrop">
      <div class="modal shortcuts-modal" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
        <div class="section-title">
          <h3 id="shortcuts-title">键盘快捷键</h3>
          <button id="shortcuts-close" class="icon-button" aria-label="关闭">${icon("close")}</button>
        </div>
        <div class="shortcuts-grid">
          ${rows.map(([key, desc]) => `
            <div class="shortcut-row">
              <span class="shortcut-desc">${escapeHtml(desc)}</span>
              <kbd>${escapeHtml(key)}</kbd>
            </div>
          `).join("")}
        </div>
        <p class="muted tiny">在输入框中输入时快捷键自动暂停。</p>
      </div>
    </div>
  `;
}

function renderMailPanel(account) {
  const folders = state.foldersByAccount[account.id] || [];
  const folder = selectedFolder(account.id);
  return html`
    <section class="panel stack">
      <div class="section-title">
        <div>
          <button class="selected-email-copy" data-copy-email="${escapeHtml(account.email)}" title="点击复制邮箱">
            ${escapeHtml(account.email)}
          </button>
          <p class="muted tiny">
            文件夹：${escapeHtml(folder)} · 未读：${Number.isFinite(state.unreadCount) ? state.unreadCount : "暂无"} · 最后读取：${formatDate(state.fetchedAt)}
          </p>
        </div>
        <button data-fetch="${account.id}" class="primary" ${state.busy || state.batchBusy || state.accountBusy ? "disabled" : ""}>
          ${state.busy ? "读取中…" : state.fetchedAt ? "刷新" : "读取邮件"}
        </button>
      </div>
      ${renderFeaturedCode()}
      <div class="folder-bar">
        <div class="form-row">
          <label for="folder-select">文件夹</label>
          <select id="folder-select" ${state.busy || state.folderBusy || state.batchBusy || state.accountBusy ? "disabled" : ""}>
            ${renderFolderOptions(folders, folder)}
          </select>
        </div>
        <button id="reload-folders" ${state.busy || state.folderBusy || state.batchBusy || state.accountBusy ? "disabled" : ""}>
          ${state.folderBusy ? "加载中" : "重新扫描文件夹"}
        </button>
        <button id="wait-code" ${state.codeBusy || state.busy || state.batchBusy || state.accountBusy || !account ? "disabled" : ""}>
          ${state.codeBusy ? "等待中" : "等待验证码"}
        </button>
      </div>
      <p class="privacy-note">
        <span class="privacy-dot" aria-hidden="true"></span>
        凭证仅保存在本机；读取邮件时只连接 Microsoft OAuth 与 IMAP，不经过第三方中转。
      </p>
      ${renderWaitCodeStatus(account)}
      ${renderMessages()}
    </section>
  `;
}

function renderFeaturedCode() {
  const found = findLatestCode(state.messages);
  if (!found) return "";
  const { code, message } = found;
  return html`
    <div class="featured-code">
      <div class="featured-code-info">
        <span class="featured-code-kicker">最新验证码 · ${escapeHtml(message.subject || "(无主题)")} · ${escapeHtml(message.receivedAt || message.date || "")}</span>
        <strong class="featured-code-value">${escapeHtml(code.value)}</strong>
      </div>
      <button class="primary" data-copy-code="${escapeHtml(code.value)}">${icon("copy")}一键复制</button>
    </div>
  `;
}

function renderWaitCodeStatus(account) {
  if (!state.codeWait || state.codeWait.accountId !== account.id) return "";
  const totalSec = Math.round(state.codeWait.timeoutMs / 1000);
  const elapsedSec = Math.min(Math.round(state.codeWait.elapsedMs / 1000), totalSec);
  const pct = Math.min(100, (elapsedSec / totalSec) * 100);
  return html`
    <div class="wait-code-progress" aria-live="polite">
      <div class="wait-code-bar"><div class="wait-code-bar-fill" style="width:${pct}%"></div></div>
      <span class="muted tiny">正在轮询验证码邮件，已等待 ${elapsedSec}s / ${totalSec}s</span>
      <button id="cancel-wait-code" class="small-button">取消</button>
    </div>
  `;
}

function renderFolderOptions(folders, selected) {
  const list = folders.length ? folders : [{ name: selected || "INBOX", label: selected || "INBOX" }];
  return list
    .map(
      (folder) => `
        <option value="${escapeHtml(folder.name)}" ${folder.name === selected ? "selected" : ""}>
          ${escapeHtml(folder.label || folder.name)}
        </option>
      `,
    )
    .join("");
}

function renderMessages() {
  if (state.busy) {
    return html`
      <div class="loading-box" role="status" aria-live="polite">
        <div class="spinner" aria-hidden="true"></div>
        <div>
          <strong>正在读取邮箱…</strong>
          <p class="muted tiny">刷新 access_token，并通过 IMAP XOAUTH2 读取 ${escapeHtml(selectedFolder())} 最后 3 封邮件。</p>
        </div>
      </div>
    `;
  }
  if (!state.messages.length) {
    const hasRead = Boolean(state.fetchedAt);
    return html`
      <div class="mail-empty-state" aria-live="polite">
        <div class="mail-empty-icon" aria-hidden="true">${icon("inbox")}</div>
        <div>
          <h3>${hasRead ? "当前文件夹暂无邮件" : `准备读取 ${escapeHtml(selectedFolder())}`}</h3>
          <p>${hasRead ? "可以稍后重新读取，或切换到其他文件夹查看。" : "读取最近 3 封邮件，并自动提取验证码与验证链接。"}</p>
        </div>
        <button class="primary" data-fetch="${escapeHtml(state.selectedId)}">
          ${hasRead ? "重新读取" : "读取最近 3 封"}
        </button>
        <span class="mail-empty-hint">快捷键：按 Enter 读取，按 W 等待验证码</span>
      </div>
    `;
  }
  return html`
    <div class="message-list readable">
      ${state.messages.map(renderMessageCard).join("")}
    </div>
  `;
}

function icon(name) {
  const icons = {
    settings: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.36a1.7 1.7 0 0 0-1 .44 1.7 1.7 0 0 0-.5 1.2V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-.5-1.2 1.7 1.7 0 0 0-1-.44 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 3.64 15a1.7 1.7 0 0 0-.44-1 1.7 1.7 0 0 0-1.2-.5H2a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.2-.5 1.7 1.7 0 0 0 .44-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8 3.64a1.7 1.7 0 0 0 1-.44A1.7 1.7 0 0 0 9.5 2V2a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 .5 1.2 1.7 1.7 0 0 0 1 .44 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.36 8c.1.35.25.68.44 1a1.7 1.7 0 0 0 1.2.5H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.2.5c-.2.32-.35.65-.44 1Z" />
      </svg>
    `,
    "panel-close": `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5h16v14H4z" />
        <path d="M9 5v14" />
        <path d="m16 9-3 3 3 3" />
      </svg>
    `,
    "panel-open": `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5h16v14H4z" />
        <path d="M9 5v14" />
        <path d="m13 9 3 3-3 3" />
      </svg>
    `,
    "chevron-down": `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
    `,
    "chevron-up": `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m18 15-6-6-6 6" />
      </svg>
    `,
    sun: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4" />
      </svg>
    `,
    moon: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
      </svg>
    `,
    keyboard: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <path d="M6 10h.01 M10 10h.01 M14 10h.01 M18 10h.01 M6 14h12" />
      </svg>
    `,
    key: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="7.5" cy="15.5" r="3.5" />
        <path d="m10 13 8-8 M15.5 7.5 18 10l3-3-2.5-2.5" />
      </svg>
    `,
    copy: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V5a2 2 0 0 1 2-2h8" />
      </svg>
    `,
    plus: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5v14 M5 12h14" />
      </svg>
    `,
    inbox: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M22 12h-6l-2 3h-4l-2-3H2" />
        <path d="M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
      </svg>
    `,
    close: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18 6 6 18 M6 6l12 12" />
      </svg>
    `,
  };
  return icons[name] || "";
}

function renderMessageCard(message, index) {
  const isError = message.from === "Error";
  return html`
    <article class="message ${isError ? "error-message" : ""}">
      <div class="message-header">
        <div>
          <div class="message-kicker">Message ${index + 1}</div>
          <h3 class="message-subject">${escapeHtml(message.subject || "(无主题)")}</h3>
        </div>
        <span class="badge ${isError ? "error" : "ok"}">${isError ? "错误" : "邮件"}</span>
      </div>
      ${renderCodes(message.codes || [])}
      <dl class="message-meta-grid">
        <div>
          <dt>发件人</dt>
          <dd>${escapeHtml(message.from || "未知")}</dd>
        </div>
        <div>
          <dt>时间</dt>
          <dd>
            ${escapeHtml(message.receivedAt || message.date || "未知")}
            ${message.receivedAt && message.date ? `<span class="muted tiny">邮件日期：${escapeHtml(message.date)}</span>` : ""}
          </dd>
        </div>
      </dl>
      ${renderMessageContent(message)}
      ${renderLinks(message.links || [])}
    </article>
  `;
}

function renderCodes(codes) {
  if (!codes.length) return "";
  return html`
    <div class="code-list">
      <div class="message-kicker">验证码</div>
      <div class="code-actions">
        ${codes.map(renderCodeChip).join("")}
      </div>
    </div>
  `;
}

function renderCodeChip(code) {
  const label = code.type === "link" ? "验证链接" : code.value;
  const attr = code.type === "link" ? `data-normal-link="${escapeHtml(code.value)}"` : `data-copy-code="${escapeHtml(code.value)}"`;
  const title = code.type === "link" ? "打开验证链接" : "复制验证码";
  return html`
    <button class="code-chip ${code.type}" ${attr} title="${title}">
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(code.type)} · ${Math.round((code.confidence || 0) * 100)}%</span>
    </button>
  `;
}

function renderMessageContent(message) {
  if (state.messageRenderMode === "html" && message.htmlBody) {
    return html`
      <div class="message-html-frame-wrap">
        <iframe
          class="message-html-frame"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          referrerpolicy="no-referrer"
          srcdoc="${escapeHtml(messageHtmlDocument(message.htmlBody))}"
        ></iframe>
      </div>
    `;
  }
  return `<div class="message-body">${renderMessageBody(message)}</div>`;
}

function messageHtmlDocument(body) {
  return `<!doctype html>
<html>
<head>
  <base target="_blank">
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      color: #172033;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      font-size: 16px;
      line-height: 1.62;
      overflow-wrap: anywhere;
    }
    img { max-width: 100%; height: auto; }
    a { color: #1768d4; font-weight: 700; }
    table { max-width: 100%; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function renderMessageBody(message) {
  const body = message.body || "(无正文)";
  const links = message.links || [];
  const linkByHref = new Map();
  for (const link of links) {
    const normalized = normalizeBodyHref(link.href);
    if (normalized) linkByHref.set(normalized, link);
  }

  let rendered = "";
  let cursor = 0;
  const matcher = /\bhttps?:\/\/[^\s<>"')]+/gi;
  for (const match of String(body).matchAll(matcher)) {
    const raw = match[0];
    const href = trimBodyHref(raw);
    const start = match.index;
    const end = start + href.length;
    if (!href || start < cursor) continue;
    rendered += escapeHtml(body.slice(cursor, start));
    const linked = linkByHref.get(normalizeBodyHref(href)) || { href, label: "" };
    rendered += renderInlineBodyLink(linked, href);
    cursor = end;
  }
  rendered += escapeHtml(body.slice(cursor));
  return rendered;
}

function trimBodyHref(href) {
  return String(href || "").replace(/[.,;:!?]+$/g, "");
}

function normalizeBodyHref(href) {
  try {
    const url = new URL(trimBodyHref(href));
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function renderInlineBodyLink(link, fallbackHref) {
  const href = normalizeBodyHref(link.href || fallbackHref);
  if (!href) return escapeHtml(fallbackHref);
  const label = inlineLinkLabel(link, href);
  return html`
    <a class="message-inline-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">
      ${escapeHtml(label)}
      <span>${escapeHtml(linkHost(href))}</span>
    </a>
  `;
}

function inlineLinkLabel(link, href) {
  const label = String(link.label || "").trim();
  if (label && label !== href && !/^https?:\/\//i.test(label) && label.length <= 80) return label;
  const host = linkHost(href);
  if (/log.?in|login|verify|confirm|signup|magic|token|email-login/i.test(href)) {
    return "打开登录链接";
  }
  return host ? `打开 ${host}` : "打开链接";
}

function renderLinks(links) {
  if (!links.length) return "";
  return html`
    <div class="link-list">
      <div class="message-kicker">精选链接</div>
      <div class="link-actions">
        ${links.map(renderMailLink).join("")}
      </div>
    </div>
  `;
}

function renderMailLink(link, index) {
  const label = link.label && link.label !== link.href ? link.label : linkHost(link.href) || `链接 ${index + 1}`;
  const primaryLabel = state.linkOpenMode === "private" ? "无痕打开" : "普通打开";
  const secondaryLabel = state.linkOpenMode === "private" ? "普通打开" : "无痕打开";
  const primaryAttr = state.linkOpenMode === "private" ? "data-private-link" : "data-normal-link";
  const secondaryAttr = state.linkOpenMode === "private" ? "data-normal-link" : "data-private-link";
  return html`
    <div class="mail-link-group">
      <a class="mail-link" href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer">
        ${escapeHtml(label)}
        <span>${escapeHtml(linkHost(link.href))}</span>
      </a>
      <button class="private-link" ${primaryAttr}="${escapeHtml(link.href)}">${primaryLabel}</button>
      <button class="normal-link" ${secondaryAttr}="${escapeHtml(link.href)}">${secondaryLabel}</button>
    </div>
  `;
}

function linkHost(href) {
  try {
    return new URL(href).host;
  } catch {
    return "";
  }
}

function bindEvents() {
  document.querySelector("#toggle-actions").addEventListener("click", () => {
    state.actionsExpanded = !state.actionsExpanded;
    render();
  });
  document.querySelector("#empty-open-actions")?.addEventListener("click", () => {
    state.actionsExpanded = true;
    state.importExpanded = true;
    render();
    document.querySelector("#csv-input")?.focus();
  });
  document.querySelector("#toggle-theme")?.addEventListener("click", toggleTheme);
  document.querySelector("#show-shortcuts")?.addEventListener("click", () => {
    state.shortcutsOpen = true;
    render();
  });
  document.querySelector("#shortcuts-close")?.addEventListener("click", () => {
    state.shortcutsOpen = false;
    render();
  });
  document.querySelector("#shortcuts-backdrop")?.addEventListener("click", (event) => {
    if (event.target.id === "shortcuts-backdrop") { state.shortcutsOpen = false; render(); }
  });
  document.querySelector("#reload-accounts")?.addEventListener("click", reloadAccounts);
  document.querySelector("#restart-app")?.addEventListener("click", restartApp);
  document.querySelector("#delete-cancel")?.addEventListener("click", () => { state.pendingDelete = null; render(); });
  document.querySelector("#delete-confirm")?.addEventListener("click", confirmPendingDelete);
  document.querySelector("#delete-backdrop")?.addEventListener("click", (event) => {
    if (event.target.id === "delete-backdrop") { state.pendingDelete = null; render(); }
  });
  document.querySelector("#select-all-accounts")?.addEventListener("click", toggleAllAccountSelection);
  document.querySelector("#delete-selected-accounts")?.addEventListener("click", deleteSelectedAccounts);
  document.querySelector("#detect-inactive-accounts")?.addEventListener("click", runTokenKeepalive);
  document.querySelector("#delete-inactive-accounts")?.addEventListener("click", deleteInactiveAccounts);
  document.querySelector("#detect-inactive-accounts-top")?.addEventListener("click", runTokenKeepalive);
  document.querySelector("#delete-inactive-accounts-top")?.addEventListener("click", deleteInactiveAccounts);
  document.querySelector("#refresh-all")?.addEventListener("click", refreshAllAccounts);
  document.querySelector("#refresh-tokens")?.addEventListener("click", runTokenKeepalive);
  document.querySelector("#fetch-selected")?.addEventListener("click", () => {
    const account = selectedAccount();
    if (account) fetchMessages(account.id);
  });
  document.querySelector("#toggle-sidebar").addEventListener("click", () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    render();
  });
  document.querySelector("#import-csv")?.addEventListener("click", importCsv);
  document.querySelector("#toggle-import")?.addEventListener("click", () => {
    state.importExpanded = !state.importExpanded;
    render();
  });
  document.querySelector("#site-form")?.addEventListener("submit", addSite);
  document.querySelectorAll("[data-site-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteSite(button.dataset.siteDelete));
  });
  document.querySelector(".sidebar")?.addEventListener("scroll", (event) => {
    state.sidebarScrollTop = event.currentTarget.scrollTop;
  });
  document.querySelector("#account-sort")?.addEventListener("change", (event) => {
    state.accountSort = event.target.value;
    state.sidebarScrollTop = 0;
    render();
  });
  document.querySelectorAll("[data-status-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.statusFilter = button.dataset.statusFilter;
      state.sidebarScrollTop = 0;
      render();
    });
  });
  document.querySelector("#clear-account-filters")?.addEventListener("click", () => {
    state.statusFilter = "all";
    state.accountQuery = "";
    render();
  });
  const accountSearch = document.querySelector("#account-search");
  accountSearch?.addEventListener("input", (event) => {
    state.accountQuery = event.target.value;
    const caret = event.target.selectionStart;
    render();
    const next = document.querySelector("#account-search");
    if (next) {
      next.focus();
      try { next.setSelectionRange(caret, caret); } catch { /* search inputs may reject range */ }
    }
  });
  document.querySelector("#link-open-mode")?.addEventListener("change", (event) => {
    state.linkOpenMode = event.target.value;
    saveSetting("linkOpenMode", state.linkOpenMode);
    render();
  });
  document.querySelector("#message-render-mode")?.addEventListener("change", (event) => {
    state.messageRenderMode = event.target.value;
    saveSetting("messageRenderMode", state.messageRenderMode);
    render();
  });
  document.querySelectorAll("[data-select]").forEach((button) => {
    button.addEventListener("click", () => selectAccountById(button.dataset.select));
  });
  document.querySelectorAll("[data-account-check]").forEach((checkbox) => {
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    checkbox.addEventListener("change", (event) => {
      event.stopPropagation();
      toggleAccountSelection(checkbox.dataset.accountCheck);
      preserveSidebarScroll(() => render());
    });
  });
  document.querySelectorAll("[data-site-toggle]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleSiteMark(button.dataset.siteToggle, Number(button.dataset.siteId));
    });
  });
  document.querySelectorAll("[data-copy-email]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      copyText(button.dataset.copyEmail, `已复制邮箱：${button.dataset.copyEmail}`);
    });
  });
  document.querySelectorAll("[data-copy-code]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      copyText(button.dataset.copyCode, `已复制验证码：${button.dataset.copyCode}`);
    });
  });
  document.querySelectorAll("[data-fetch]").forEach((button) => {
    button.addEventListener("click", () => fetchMessages(button.dataset.fetch));
  });
  document.querySelectorAll("[data-private-link]").forEach((button) => {
    button.addEventListener("click", () => openPrivate(button.dataset.privateLink));
  });
  document.querySelectorAll("[data-normal-link]").forEach((button) => {
    button.addEventListener("click", () => openNormal(button.dataset.normalLink));
  });
  document.querySelector("#reload-folders")?.addEventListener("click", () => {
    const account = selectedAccount();
    if (account) loadFolders(account.id, true);
  });
  document.querySelector("#wait-code")?.addEventListener("click", waitForCode);
  document.querySelector("#cancel-wait-code")?.addEventListener("click", cancelWaitForCode);
  document.querySelector("#folder-select")?.addEventListener("change", (event) => {
    const account = selectedAccount();
    if (!account || state.accountBusy) return;
    state.selectedFolderByAccount[account.id] = event.target.value;
    state.messages = [];
    state.fetchedAt = "";
    state.unreadCount = null;
    render();
    fetchMessages(account.id);
  });
}

async function loadTokenStatus() {
  clearTimeout(loadTokenStatus.timer);
  try {
    state.tokenStatus = await api("/api/token-keepalive/status", { timeoutMs: 10_000 });
    render();
    if (state.tokenStatus?.running) {
      loadTokenStatus.timer = setTimeout(loadTokenStatus, 1500);
    }
  } catch {
    // Token keepalive status is informational; ignore transient failures.
  }
}

async function runTokenKeepalive() {
  try {
    state.tokenBusy = true;
    render();
    const summary = await api("/api/token-keepalive/run", {
      method: "POST",
      body: "{}",
      timeoutMs: Math.max(120_000, state.accounts.length * 25_000),
    });
    state.tokenStatus = {
      running: false,
      lastSummary: summary,
      accountResults: summary.accountResults || [],
      lastFinishedAt: new Date().toISOString(),
    };
    await reloadAccounts();
    toast(`refresh token 保活完成：成功 ${summary.refreshed || 0}，轮换 ${summary.rotated || 0}，失败 ${summary.failed || 0}。`);
  } catch (error) {
    toast(`refresh token 保活失败：${error.message}`);
  } finally {
    state.tokenBusy = false;
    render();
  }
}

async function openPrivate(url) {
  try {
    const data = await api("/api/open-private", {
      method: "POST",
      body: JSON.stringify({ url }),
      timeoutMs: 10_000,
    });
    toast(`已尝试用 ${data.command} 打开无痕窗口。`);
  } catch (error) {
    toast(`无痕打开失败：${error.message}`);
  }
}

async function openNormal(url) {
  try {
    const data = await api("/api/open-link", {
      method: "POST",
      body: JSON.stringify({ url }),
      timeoutMs: 10_000,
    });
    toast(`已尝试用 ${data.command} 普通打开。`);
  } catch (error) {
    toast(`普通打开失败：${error.message}`);
  }
}

async function restartApp() {
  try {
    await api("/api/restart", {
      method: "POST",
      body: "{}",
      timeoutMs: 10_000,
    });
    toast("正在重启应用...");
  } catch (error) {
    toast(`重启失败：${error.message}`);
  }
}

async function reloadAccounts() {
  try {
    const data = await api("/api/accounts");
    state.accounts = data.accounts || [];
    pruneSelectedAccounts();
    if (!state.accounts.some((account) => account.id === state.selectedId)) {
      state.selectedId = state.accounts[0]?.id || null;
      state.messages = [];
      state.fetchedAt = "";
      state.unreadCount = null;
    }
    render();
    if (state.selectedId) loadFolders(state.selectedId, false);
  } catch (error) {
    toast(error.message);
  }
}

async function addSite(event) {
  event.preventDefault();
  const input = document.querySelector("#site-input");
  const site = input?.value.trim();
  if (!site) return;
  try {
    state.siteBusy = true;
    render();
    const data = await api("/api/sites", {
      method: "POST",
      body: JSON.stringify({ site }),
      timeoutMs: 10_000,
    });
    state.sites = data.sites || [];
    toast(`已加入网站：${site}`);
  } catch (error) {
    toast(`添加网站失败：${error.message}`);
  } finally {
    state.siteBusy = false;
    render();
  }
}

async function deleteSite(siteId) {
  try {
    state.siteBusy = true;
    render();
    const data = await api(`/api/sites/${siteId}`, {
      method: "DELETE",
      timeoutMs: 10_000,
    });
    state.sites = data.sites || [];
    state.accounts = data.accounts || state.accounts;
    toast("已删除网站标记。");
  } catch (error) {
    toast(`删除网站失败：${error.message}`);
  } finally {
    state.siteBusy = false;
    render();
  }
}

async function deleteSelectedAccounts() {
  const ids = [...(state.selectedAccountIds || [])];
  return deleteAccountsByIds(ids, "已选账号");
}

async function deleteInactiveAccounts() {
  const ids = inactiveAccountIdList();
  if (!ids.length) {
    toast("当前没有明确失活的账号，请先点击检测失活。");
    return;
  }
  return deleteAccountsByIds(ids, "失活账号");
}

function deleteAccountsByIds(ids, accountLabel) {
  if (!ids.length || accountSelectionBusy()) return;
  const emails = state.accounts.filter((account) => ids.includes(account.id)).map((account) => account.email);
  state.pendingDelete = { ids: [...ids], accountLabel, emails };
  render();
}

async function confirmPendingDelete() {
  const pending = state.pendingDelete;
  if (!pending || accountSelectionBusy()) return;
  const { ids, accountLabel } = pending;
  state.pendingDelete = null;
  let shouldLoadFolders = false;
  try {
    state.accountBusy = true;
    render();
    const data = await api("/api/accounts/batch-delete", {
      method: "POST",
      body: JSON.stringify({ ids }),
      timeoutMs: 20_000,
    });
    state.accounts = data.accounts || [];
    const deletedIds = new Set(ids);
    setAccountSelection(state.selectedAccountIds.filter((id) => !deletedIds.has(id)));
    for (const id of ids) {
      delete state.refreshStateByAccount[id];
      delete state.foldersByAccount[id];
      delete state.selectedFolderByAccount[id];
    }
    if (!state.accounts.some((account) => account.id === state.selectedId)) {
      state.selectedId = state.accounts[0]?.id || null;
      const refresh = accountRefreshState(state.selectedId);
      state.messages = refresh.status === "ok" ? refresh.messages || [] : [];
      state.fetchedAt = refresh.fetchedAt || "";
      state.unreadCount = refresh.unreadCount ?? null;
      shouldLoadFolders = Boolean(state.selectedId && !state.foldersByAccount[state.selectedId]);
    }
    toast(`已删除 ${data.deleted ?? ids.length} 个${accountLabel}。`);
  } catch (error) {
    toast(`删除账号失败：${error.message}`);
  } finally {
    state.accountBusy = false;
    render();
  }
  if (shouldLoadFolders) loadFolders(state.selectedId, false);
}

async function toggleSiteMark(accountId, siteId) {
  const account = state.accounts.find((item) => item.id === accountId);
  if (!account || !siteId || state.accountBusy || state.siteBusy) return;
  state.siteBusy = true;
  const current = new Set(account.siteIds || []);
  const marked = !current.has(siteId);
  if (marked) current.add(siteId);
  else current.delete(siteId);
  account.siteIds = [...current];
  preserveSidebarScroll(() => render());

  try {
    const data = await api(`/api/accounts/${accountId}/sites/${siteId}`, {
      method: "PUT",
      body: JSON.stringify({ marked }),
      timeoutMs: 10_000,
    });
    if (!hasAccount(accountId)) return;
    state.accounts = data.accounts || state.accounts;
    const site = state.sites.find((item) => item.id === siteId);
    toast(`${account.email} ${marked ? "已标记" : "已取消"} ${site?.name || "网站"}`);
  } catch (error) {
    if (!hasAccount(accountId)) return;
    if (marked) current.delete(siteId);
    else current.add(siteId);
    account.siteIds = [...current];
    toast(`网站标记失败：${error.message}`);
  } finally {
    state.siteBusy = false;
    preserveSidebarScroll(() => render());
  }
}

async function importCsv() {
  if (state.importBusy || state.accountBusy) return;
  const csv = document.querySelector("#csv-input").value;
  try {
    state.importBusy = true;
    render();
    const data = await api("/api/import", {
      method: "POST",
      body: JSON.stringify({ credentials: csv }),
    });
    state.accounts = data.accounts || [];
    pruneSelectedAccounts();
    state.refreshStateByAccount = {};
    state.tokenStatus = null;
    state.selectedId = state.selectedId || state.accounts[0]?.id || null;
    state.messages = [];
    state.fetchedAt = "";
    state.unreadCount = null;
    const firstError = data.errors?.[0]
      ? ` 第一个错误：第 ${data.errors[0].line} 行，${data.errors[0].reason}`
      : "";
    toast(`导入 ${data.imported} 行，错误 ${data.errors?.length || 0} 行。${firstError}`);
    render();
    if (state.selectedId) loadFolders(state.selectedId, false);
  } catch (error) {
    toast(error.message);
  } finally {
    state.importBusy = false;
    render();
  }
}

async function loadFolders(id, foreground = false) {
  if (!hasAccount(id) || state.accountBusy) return;
  try {
    state.folderBusy = foreground;
    if (foreground) render();
    const data = await api(`/api/accounts/${id}/folders`, { timeoutMs: 90_000 });
    if (!hasAccount(id)) return;
    state.foldersByAccount[id] = data.folders || [];
    if (!state.selectedFolderByAccount[id]) {
      const inbox = state.foldersByAccount[id].find((folder) => folder.name.toLowerCase() === "inbox");
      state.selectedFolderByAccount[id] = inbox?.name || state.foldersByAccount[id][0]?.name || "INBOX";
    }
  } catch (error) {
    if (!hasAccount(id)) return;
    if (foreground) toast(`文件夹加载失败：${error.message}`);
    state.foldersByAccount[id] = state.foldersByAccount[id] || [{ name: "INBOX", label: "Inbox / 收件箱" }];
    state.selectedFolderByAccount[id] = state.selectedFolderByAccount[id] || "INBOX";
  } finally {
    state.folderBusy = false;
    preserveSidebarScroll(() => render());
  }
}

async function fetchMessages(id) {
  if (!hasAccount(id) || state.accountBusy || state.busy) return;
  const folder = selectedFolder(id);
  try {
    state.busy = true;
    if (state.selectedId === id) {
      state.messages = [];
      state.unreadCount = null;
    }
    render();
    const data = await api(`/api/accounts/${id}/fetch`, {
      method: "POST",
      body: JSON.stringify({ folder }),
      timeoutMs: 95_000,
    });
    if (!hasAccount(id)) return;
    const messages = data.messages || [];
    const unreadCount = data.unreadCount ?? data.account?.unreadCount ?? null;
    const fetchedAt = data.account?.fetchedAt || new Date().toISOString();
    state.refreshStateByAccount[id] = {
      status: "ok",
      folder: data.account?.folder || folder,
      unreadCount,
      messages,
      fetchedAt,
    };
    if (state.selectedId === id) {
      state.messages = messages;
      state.unreadCount = unreadCount;
      state.fetchedAt = fetchedAt;
    }
  } catch (error) {
    if (!hasAccount(id)) return;
    const fetchedAt = new Date().toISOString();
    const messages = [
      {
        from: "Error",
        date: fetchedAt,
        subject: "读取失败",
        body: error.message,
      },
    ];
    state.refreshStateByAccount[id] = {
      status: "error",
      folder,
      error: error.message,
      failure: error.failure || null,
      inactive: Boolean(error.failure?.terminal),
      fetchedAt,
    };
    if (state.selectedId === id) {
      state.messages = messages;
      state.fetchedAt = fetchedAt;
      state.unreadCount = null;
    }
  } finally {
    state.busy = false;
    render();
  }
}

async function waitForCode() {
  const account = selectedAccount();
  if (!account || state.codeBusy || state.accountBusy) return;
  const accountId = account.id;
  const folder = selectedFolder(accountId);
  const timeoutMs = 60_000;
  const controller = new AbortController();
  state.codeBusy = true;
  state.codeWait = { accountId, startedAt: Date.now(), elapsedMs: 0, timeoutMs, controller };
  const tick = window.setInterval(() => {
    if (!state.codeWait || state.codeWait.accountId !== accountId) return;
    state.codeWait.elapsedMs = Date.now() - state.codeWait.startedAt;
    render();
  }, 1000);
  try {
    render();
    const data = await api(`/api/accounts/${accountId}/code`, {
      method: "POST",
      body: JSON.stringify({
        folder,
        wait: true,
        timeoutMs,
        since: new Date().toISOString(),
      }),
      timeoutMs: 70_000,
      signal: controller.signal,
    });
    if (!hasAccount(accountId)) return;
    const previousRefresh = accountRefreshState(accountId);
    const previousMessages = previousRefresh.status === "ok"
      ? previousRefresh.messages || []
      : state.selectedId === accountId
        ? state.messages
        : [];
    const unreadCount = data.unreadCount ?? previousRefresh.unreadCount ?? null;
    const fetchedAt = data.account?.fetchedAt || new Date().toISOString();
    if (data.message) {
      const messages = [data.message, ...previousMessages.filter((message) => message.uid !== data.message.uid)];
      state.refreshStateByAccount[accountId] = {
        status: "ok",
        folder,
        unreadCount,
        messages,
        fetchedAt,
      };
      if (state.selectedId === accountId) {
        state.messages = messages;
        state.unreadCount = unreadCount;
        state.fetchedAt = fetchedAt;
      }
      if (data.code?.type === "link") {
        toast(`${account.email} 已找到验证链接。`);
      } else if (data.code?.value) {
        await copyText(data.code.value, `${account.email} 已找到并复制验证码：${data.code.value}`);
      } else {
        toast(`${account.email} 已找到验证码邮件。`);
      }
    } else {
      if (state.selectedId === accountId) {
        state.unreadCount = unreadCount;
        state.fetchedAt = fetchedAt;
      }
      toast(`${account.email} 等待 60 秒后仍未发现验证码。`);
    }
  } catch (error) {
    if (controller.signal.aborted) {
      if (hasAccount(accountId)) toast(`${account.email} 已取消等待验证码。`);
    } else if (hasAccount(accountId)) {
      toast(`等待验证码失败：${error.message}`);
    }
  } finally {
    window.clearInterval(tick);
    state.codeBusy = false;
    state.codeWait = null;
    render();
  }
}

function cancelWaitForCode() {
  state.codeWait?.controller.abort();
}

async function refreshAllAccounts() {
  if (!state.accounts.length || state.batchBusy) return;
  state.batchBusy = true;
  state.batchProgress = { done: 0, total: state.accounts.length };
  for (const account of state.accounts) {
    state.refreshStateByAccount[account.id] = {
      status: "queued",
      folder: selectedFolder(account.id),
    };
  }
  render();

  let okCount = 0;
  let errorCount = 0;
  for (const account of state.accounts) {
    const folder = selectedFolder(account.id);
    state.refreshStateByAccount[account.id] = { status: "running", folder };
    render();
    try {
      const data = await api(`/api/accounts/${account.id}/fetch`, {
        method: "POST",
        body: JSON.stringify({ folder }),
        timeoutMs: 95_000,
      });
      const fetchedAt = data.account?.fetchedAt || new Date().toISOString();
      const messages = data.messages || [];
      const unreadCount = data.unreadCount ?? data.account?.unreadCount ?? null;
      state.refreshStateByAccount[account.id] = {
        status: "ok",
        folder,
        unreadCount,
        messages,
        fetchedAt,
      };
      if (account.id === state.selectedId) {
        state.messages = messages;
        state.unreadCount = unreadCount;
        state.fetchedAt = fetchedAt;
      }
      okCount += 1;
    } catch (error) {
      const fetchedAt = new Date().toISOString();
      state.refreshStateByAccount[account.id] = {
        status: "error",
        folder,
        error: error.message,
        failure: error.failure || null,
        inactive: Boolean(error.failure?.terminal),
        fetchedAt,
      };
      if (account.id === state.selectedId) {
        state.messages = [
          {
            from: "Error",
            date: fetchedAt,
            subject: "读取失败",
            body: error.message,
          },
        ];
        state.unreadCount = null;
        state.fetchedAt = fetchedAt;
      }
      errorCount += 1;
    } finally {
      state.batchProgress.done += 1;
      render();
    }
  }

  state.batchBusy = false;
  render();
  toast(`批量刷新完成：正常 ${okCount} 个，异常 ${errorCount} 个。`);
}

boot().catch((error) => {
  app.innerHTML = `<main class="auth-screen"><div class="auth-card"><h1>启动失败</h1><p>${escapeHtml(error.message)}</p></div></main>`;
});

document.addEventListener("keydown", (event) => {
  const target = event.target;
  const tag = target?.tagName;
  const isTyping = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable;

  if (event.key === "Escape") {
    if (state.shortcutsOpen) { state.shortcutsOpen = false; render(); return; }
    if (state.pendingDelete) { state.pendingDelete = null; render(); return; }
    if (tag === "INPUT" && target.id === "account-search") {
      if (state.accountQuery) { state.accountQuery = ""; render(); }
      target.blur();
      return;
    }
    if (isTyping) target.blur();
    return;
  }

  if (isTyping || event.metaKey || event.ctrlKey || event.altKey) return;

  switch (event.key.toLowerCase()) {
    case "j":
    case "arrowdown":
      event.preventDefault();
      moveAccountSelection(1);
      return;
    case "k":
    case "arrowup":
      event.preventDefault();
      moveAccountSelection(-1);
      return;
    case "enter":
    case "r": {
      const account = selectedAccount();
      if (account && !state.busy && !state.batchBusy && !state.accountBusy) fetchMessages(account.id);
      return;
    }
    case "/":
      event.preventDefault();
      document.querySelector("#account-search")?.focus();
      return;
    case "w":
      if (selectedAccount() && !state.codeBusy && !state.busy && !state.batchBusy && !state.accountBusy) waitForCode();
      return;
    case "a":
      state.actionsExpanded = !state.actionsExpanded;
      render();
      return;
    case "d":
      toggleTheme();
      return;
    case "?":
      state.shortcutsOpen = true;
      render();
      return;
    default:
      return;
  }
});
