const app = document.querySelector("#app");
const APP_VERSION = "v2.0";

const state = {
  accounts: [],
  selectedId: null,
  foldersByAccount: {},
  selectedFolderByAccount: {},
  refreshStateByAccount: {},
  messages: [],
  fetchedAt: "",
  unreadCount: null,
  busy: false,
  folderBusy: false,
  batchBusy: false,
  batchProgress: { done: 0, total: 0 },
  actionsExpanded: false,
  importExpanded: false,
  sidebarCollapsed: false,
  sites: [],
  siteBusy: false,
  tokenBusy: false,
  tokenStatus: null,
  accountSort: "email",
  sidebarScrollTop: 0,
  toast: "",
};

async function api(path, options = {}) {
  const timeoutMs = options.timeoutMs || 65_000;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
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
      throw new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒），请稍后重试。`);
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败：${response.status}`);
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

function sortedAccounts() {
  const accounts = [...state.accounts];
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

function messageCountLabel(messages) {
  return `${messages.length} 封摘要`;
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
  app.innerHTML = html`
    <div class="app-shell ${state.sidebarCollapsed ? "sidebar-collapsed" : ""}">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="img">
              <path d="M4 6.5h16v11H4z" />
              <path d="m4 7 8 6 8-6" />
            </svg>
          </div>
          <div>
            <h1>邮箱聚合平台</h1>
          </div>
          <span class="version-badge">${APP_VERSION}</span>
        </div>
        <button id="toggle-actions" class="icon-button primary" aria-label="${state.actionsExpanded ? "收起账号操作" : "展开账号操作"}" title="${state.actionsExpanded ? "收起账号操作" : "展开账号操作"}" aria-expanded="${state.actionsExpanded ? "true" : "false"}">
          ${icon("settings")}
        </button>
      </header>
      ${renderActionsPanel(account)}
      <main class="layout">
        <aside class="sidebar">
          <div class="section-title">
            <div>
              <h2>账号列表</h2>
              <span class="muted tiny">${state.accounts.length} 个账号</span>
            </div>
            <button id="toggle-sidebar" class="icon-button" aria-label="${state.sidebarCollapsed ? "展开账号列表" : "收起账号列表"}" title="${state.sidebarCollapsed ? "展开账号列表" : "收起账号列表"}" aria-expanded="${state.sidebarCollapsed ? "false" : "true"}">
              ${icon(state.sidebarCollapsed ? "panel-open" : "panel-close")}
            </button>
          </div>
          <div class="account-sort">
            <label for="account-sort">排序</label>
            <select id="account-sort">
              <option value="email" ${state.accountSort === "email" ? "selected" : ""}>按字母</option>
              <option value="imported" ${state.accountSort === "imported" ? "selected" : ""}>按导入时间</option>
            </select>
          </div>
          <div class="account-list">
            ${accounts.length
              ? accounts.map(renderAccountRow).join("")
              : `<div class="empty compact">暂无账号。展开账号操作后添加账号。</div>`}
          </div>
        </aside>
        <section class="content">
          <div class="stack">
            ${account ? renderMailPanel(account) : renderEmptyPanel()}
          </div>
        </section>
      </main>
      ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
    </div>
  `;
  bindEvents();
  restoreSidebarScroll();
}

function renderAccountRow(account, index) {
  const refresh = accountRefreshState(account.id);
  return html`
    <div class="account-row ${account.id === state.selectedId ? "active" : ""}" data-select="${account.id}" role="button" tabindex="0">
      <span class="account-index">${String(index + 1).padStart(2, "0")}</span>
      <div class="account-row-body">
        <div class="account-email">${escapeHtml(account.email)}</div>
        <div class="account-meta">
          <span class="badge">client_id ${escapeHtml(account.clientId.slice(0, 8))}...</span>
          <span class="badge">导入 ${formatDate(account.importedAt || account.updatedAt)}</span>
          <span class="badge">更新 ${formatDate(account.updatedAt)}</span>
          ${renderAccountStatusBadges(refresh)}
        </div>
        ${renderSiteDots(account)}
        ${renderAccountSummary(refresh)}
      </div>
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

function renderAccountStatusBadges(refresh) {
  const statusMap = {
    idle: { label: "待刷新", className: "pending" },
    queued: { label: "排队中", className: "pending" },
    running: { label: "刷新中", className: "warning" },
    ok: { label: "正常", className: "ok" },
    error: { label: "异常", className: "error" },
  };
  const status = statusMap[refresh.status || "idle"] || statusMap.idle;
  return html`
    <span class="badge ${status.className}">${status.label}</span>
    ${Number.isFinite(refresh.unreadCount) ? `<span class="badge ok">未读 ${refresh.unreadCount}</span>` : ""}
  `;
}

function renderAccountSummary(refresh) {
  if (refresh.status === "running") {
    return `<div class="account-refresh-line">正在刷新 ${escapeHtml(refresh.folder || "INBOX")}...</div>`;
  }
  if (refresh.status === "queued") {
    return `<div class="account-refresh-line">等待刷新 ${escapeHtml(refresh.folder || "INBOX")}</div>`;
  }
  if (refresh.status === "error") {
    return `<div class="account-refresh-line error-text">${escapeHtml(refresh.error || "刷新失败")}</div>`;
  }
  if (refresh.status === "ok") {
    return html`
      <div class="account-refresh-line">
        ${escapeHtml(refresh.folder || "INBOX")} · ${messageCountLabel(refresh.messages || [])} · ${formatDate(refresh.fetchedAt)}
      </div>
      ${renderAccountMiniMessages(refresh.messages || [])}
    `;
  }
  return "";
}

function renderAccountMiniMessages(messages) {
  if (!messages.length) return `<div class="account-mini-messages muted">当前文件夹暂无邮件摘要</div>`;
  return html`
    <div class="account-mini-messages">
      ${messages
        .slice(0, 3)
        .map(
          (message) => `
            <div class="account-mini-message">
              <span>${escapeHtml(message.subject || "(无主题)")}</span>
              <small>${escapeHtml(message.from || "未知发件人")}</small>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderActionsPanel(account) {
  if (!state.actionsExpanded) return "";
  return html`
    <section class="actions-panel">
      <div class="actions-row">
        <button id="reload-accounts">重新加载账号</button>
        <button id="refresh-all" ${!state.accounts.length || state.batchBusy || state.busy ? "disabled" : ""}>
          ${state.batchBusy ? `批量刷新 ${state.batchProgress.done}/${state.batchProgress.total}` : "批量刷新全部"}
        </button>
        <button id="fetch-selected" class="primary" ${!account || state.busy || state.batchBusy ? "disabled" : ""}>
          ${state.busy ? "读取中" : "读取最后 3 封"}
        </button>
        <button id="refresh-tokens" ${!state.accounts.length || state.tokenBusy ? "disabled" : ""}>
          ${state.tokenBusy ? "保活中" : "刷新 refresh token"}
        </button>
        ${renderTokenStatus()}
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
              <textarea id="csv-input" spellcheck="false" placeholder="email----标识----client_id----refresh_token
user@example.com----note----xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx----0.A..."></textarea>
              <div class="import-actions">
                <div id="import-result" class="muted tiny"></div>
                <button id="import-csv" class="primary">写入 SQLite</button>
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
          <input id="site-input" type="text" placeholder="例如 github.com、amazon、paypal" autocomplete="off" />
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
  if (!status?.lastSummary && !status?.running) return "";
  if (status.running) return `<span class="muted tiny">refresh token 保活运行中...</span>`;
  const summary = status.lastSummary || {};
  return html`
    <span class="muted tiny">
      token 保活：${summary.refreshed || 0}/${summary.total || 0} 成功，轮换 ${summary.rotated || 0}，失败 ${summary.failed || 0}
    </span>
  `;
}

function renderEmptyPanel() {
  return html`
    <section class="panel empty">
      展开账号操作添加账号后，选择一个账号读取邮件。
    </section>
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
        <button data-fetch="${account.id}" class="primary" ${state.busy || state.batchBusy ? "disabled" : ""}>
          ${state.busy ? "读取中" : "刷新"}
        </button>
      </div>
      <div class="folder-bar">
        <div class="form-row">
          <label for="folder-select">文件夹</label>
          <select id="folder-select" ${state.busy || state.folderBusy || state.batchBusy ? "disabled" : ""}>
            ${renderFolderOptions(folders, folder)}
          </select>
        </div>
        <button id="reload-folders" ${state.busy || state.folderBusy || state.batchBusy ? "disabled" : ""}>
          ${state.folderBusy ? "加载中" : "重新扫描文件夹"}
        </button>
      </div>
      ${renderMessages()}
    </section>
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
      <div class="loading-box">
        <div class="spinner"></div>
        <div>
          <strong>正在读取邮箱</strong>
          <p class="muted tiny">刷新 access_token，并通过 IMAP XOAUTH2 读取 ${escapeHtml(selectedFolder())} 最后 3 封邮件。</p>
        </div>
      </div>
    `;
  }
  if (!state.messages.length) {
    return "";
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
      <div class="message-body">${escapeHtml(message.body || "(无正文)")}</div>
      ${renderLinks(message.links || [])}
    </article>
  `;
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
  return html`
    <div class="mail-link-group">
      <a class="mail-link" href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer">
        ${escapeHtml(label)}
        <span>${escapeHtml(linkHost(link.href))}</span>
      </a>
      <button class="private-link" data-private-link="${escapeHtml(link.href)}">无痕打开</button>
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
  document.querySelector("#reload-accounts")?.addEventListener("click", reloadAccounts);
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
  document.querySelectorAll("[data-select]").forEach((button) => {
    const selectAccount = () => {
      preserveSidebarScroll(() => {
        state.selectedId = button.dataset.select;
        const refresh = accountRefreshState(button.dataset.select);
        state.messages = refresh.status === "ok" ? refresh.messages || [] : [];
        state.fetchedAt = refresh.fetchedAt || "";
        state.unreadCount = refresh.unreadCount ?? null;
        render();
      });
      loadFolders(button.dataset.select, false);
    };
    button.addEventListener("click", selectAccount);
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectAccount();
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
  document.querySelectorAll("[data-fetch]").forEach((button) => {
    button.addEventListener("click", () => fetchMessages(button.dataset.fetch));
  });
  document.querySelectorAll("[data-private-link]").forEach((button) => {
    button.addEventListener("click", () => openPrivate(button.dataset.privateLink));
  });
  document.querySelector("#reload-folders")?.addEventListener("click", () => {
    const account = selectedAccount();
    if (account) loadFolders(account.id, true);
  });
  document.querySelector("#folder-select")?.addEventListener("change", (event) => {
    const account = selectedAccount();
    if (!account) return;
    state.selectedFolderByAccount[account.id] = event.target.value;
    state.messages = [];
    state.fetchedAt = "";
    state.unreadCount = null;
    render();
    fetchMessages(account.id);
  });
}

async function loadTokenStatus() {
  try {
    state.tokenStatus = await api("/api/token-keepalive/status", { timeoutMs: 10_000 });
    render();
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

async function reloadAccounts() {
  try {
    const data = await api("/api/accounts");
    state.accounts = data.accounts || [];
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

async function toggleSiteMark(accountId, siteId) {
  const account = state.accounts.find((item) => item.id === accountId);
  if (!account || !siteId) return;
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
    state.accounts = data.accounts || state.accounts;
    const site = state.sites.find((item) => item.id === siteId);
    toast(`${account.email} ${marked ? "已标记" : "已取消"} ${site?.name || "网站"}`);
  } catch (error) {
    if (marked) current.delete(siteId);
    else current.add(siteId);
    account.siteIds = [...current];
    toast(`网站标记失败：${error.message}`);
  } finally {
    preserveSidebarScroll(() => render());
  }
}

async function importCsv() {
  try {
    const csv = document.querySelector("#csv-input").value;
    const data = await api("/api/import", {
      method: "POST",
      body: JSON.stringify({ credentials: csv }),
    });
    state.accounts = data.accounts || [];
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
  }
}

async function loadFolders(id, foreground = false) {
  try {
    state.folderBusy = foreground;
    if (foreground) render();
    const data = await api(`/api/accounts/${id}/folders`, { timeoutMs: 90_000 });
    state.foldersByAccount[id] = data.folders || [];
    if (!state.selectedFolderByAccount[id]) {
      const inbox = state.foldersByAccount[id].find((folder) => folder.name.toLowerCase() === "inbox");
      state.selectedFolderByAccount[id] = inbox?.name || state.foldersByAccount[id][0]?.name || "INBOX";
    }
  } catch (error) {
    if (foreground) toast(`文件夹加载失败：${error.message}`);
    state.foldersByAccount[id] = state.foldersByAccount[id] || [{ name: "INBOX", label: "Inbox / 收件箱" }];
    state.selectedFolderByAccount[id] = state.selectedFolderByAccount[id] || "INBOX";
  } finally {
    state.folderBusy = false;
    preserveSidebarScroll(() => render());
  }
}

async function fetchMessages(id) {
  try {
    state.busy = true;
    state.messages = [];
    state.unreadCount = null;
    render();
    const data = await api(`/api/accounts/${id}/fetch`, {
      method: "POST",
      body: JSON.stringify({ folder: selectedFolder(id) }),
      timeoutMs: 95_000,
    });
    state.messages = data.messages || [];
    state.unreadCount = data.unreadCount ?? data.account?.unreadCount ?? null;
    state.fetchedAt = data.account?.fetchedAt || new Date().toISOString();
    state.refreshStateByAccount[id] = {
      status: "ok",
      folder: data.account?.folder || selectedFolder(id),
      unreadCount: state.unreadCount,
      messages: state.messages,
      fetchedAt: state.fetchedAt,
    };
  } catch (error) {
    state.messages = [
      {
        from: "Error",
        date: new Date().toISOString(),
        subject: "读取失败",
        body: error.message,
      },
    ];
    state.fetchedAt = new Date().toISOString();
    state.unreadCount = null;
    state.refreshStateByAccount[id] = {
      status: "error",
      folder: selectedFolder(id),
      error: error.message,
      fetchedAt: state.fetchedAt,
    };
  } finally {
    state.busy = false;
    render();
  }
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
