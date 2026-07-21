import {
  ACCOUNTS, EMAILS, GROUPS, PROVIDERS, STATUS_META, statusCounts,
  escapeHtml, initials, providerColor,
} from "./data.js";

const app = document.querySelector("#app");
const layer = document.querySelector("#layer");

/* ---------------- icons (stroke, 24x24) ---------------- */
const P = {
  inbox: "M22 12h-6l-2 3h-4l-2-3H2 M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
  star: "M12 3l2.6 5.5 6 .9-4.3 4.2 1 6L12 17.8 6.7 19.6l1-6L3.4 9.4l6-.9z",
  sent: "M22 2 11 13 M22 2 15 22l-4-9-9-4z",
  draft: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M23 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3",
  reply: "M9 17 4 12l5-5 M4 12h11a5 5 0 0 1 5 5v2",
  forward: "M15 17l5-5-5-5 M20 12H9a5 5 0 0 0-5 5v2",
  archive: "M21 8v13H3V8 M1 3h22v5H1z M10 12h4",
  trash: "M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6",
  more: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2 M19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2 M5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2",
  attach: "M21.4 11.05 12.25 20.2a5 5 0 0 1-7.07-7.07l9.19-9.19a3 3 0 0 1 4.24 4.24l-9.2 9.19a1 1 0 0 1-1.41-1.41l8.49-8.49",
  chevronDown: "m6 9 6 6 6-6",
  chevronRight: "m9 6 6 6-6 6",
  chevronLeft: "m15 6-6 6 6 6",
  check: "M20 6 9 17l-5-5",
  x: "M18 6 6 18 M6 6l12 12",
  plus: "M12 5v14 M5 12h14",
  refresh: "M23 4v6h-6 M1 20v-6h6 M3.5 9a9 9 0 0 1 14.9-3.4L23 10 M1 14l4.6 4.4A9 9 0 0 0 20.5 15",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6",
  clipboard: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2 M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z",
  edit: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3",
  key: "M21 2l-2 2m-7.6 7.6a5 5 0 1 0-1.4 1.4l1.4-1.4 2 2 2-2 2 2 2.6-2.6-2-2z",
  filter: "M22 3H2l8 9.5V19l4 2v-8.5z",
  mailOpen: "M22 13V7l-10-5L2 7v6 M2 13l10 6 10-6 M2 13v5a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5",
};
function icon(name, cls = "i") { return `<svg class="${cls}" viewBox="0 0 24 24"><path d="${P[name] || ""}"/></svg>`; }

/* ---------------- state ---------------- */
const state = {
  view: "inbox",                 // inbox | accounts | import
  // inbox
  folder: "inbox",
  mailboxFilter: [],             // account ids; empty = all
  inboxQuery: "",
  selectedMail: EMAILS[0]?.id || null,
  popover: null,                 // mailbox picker
  popoverQuery: "",
  // accounts
  acctQuery: "",
  acctStatus: "all",
  acctProvider: "all",
  acctGroup: "all",
  acctSort: { key: "email", dir: "asc" },
  acctPage: 1,
  acctPageSize: 25,
  checked: new Set(),
  loading: false,
  // import
  step: 1,
  importMethod: "paste",
  importSkipDup: true,
  importSimulate: true,
  progress: 0,
  // shared
  toasts: [],
  modal: null,
};

/* ---------------- helpers ---------------- */
function folderEmails() {
  let list = EMAILS.filter((m) => m.folder === state.folder || (state.folder === "starred" && m.starred));
  if (state.folder === "starred") list = EMAILS.filter((m) => m.starred);
  if (state.mailboxFilter.length) list = list.filter((m) => state.mailboxFilter.includes(m.accountId));
  const q = state.inboxQuery.trim().toLowerCase();
  if (q) list = list.filter((m) => [m.from, m.subject, m.snippet, m.accountEmail].join(" ").toLowerCase().includes(q));
  return list.sort((a, b) => a.minAgo - b.minAgo);
}
function selectedMail() { return EMAILS.find((m) => m.id === state.selectedMail) || null; }

function filteredAccounts() {
  let list = ACCOUNTS.slice();
  if (state.acctStatus !== "all") list = list.filter((a) => a.status === state.acctStatus);
  if (state.acctProvider !== "all") list = list.filter((a) => a.provider === state.acctProvider);
  if (state.acctGroup !== "all") list = list.filter((a) => a.group === state.acctGroup);
  const q = state.acctQuery.trim().toLowerCase();
  if (q) list = list.filter((a) => a.email.toLowerCase().includes(q) || a.groupName.includes(q) || a.providerName.toLowerCase().includes(q));
  const { key, dir } = state.acctSort;
  const s = dir === "asc" ? 1 : -1;
  list.sort((a, b) => {
    let av = a[key], bv = b[key];
    if (key === "lastSync") { av = a.lastSyncMin; bv = b.lastSyncMin; }
    if (typeof av === "string") return av.localeCompare(bv, "en") * s;
    return (av - bv) * s;
  });
  return list;
}

/* ---------------- render root ---------------- */
function render() {
  app.innerHTML = `
    <div class="app">
      ${renderTopbar()}
      <div class="body">${renderView()}</div>
    </div>`;
  bindTopbar();
  if (state.view === "inbox") bindInbox();
  else if (state.view === "accounts") bindAccounts();
  else if (state.view === "import") bindImport();
  renderLayer();
}

function renderTopbar() {
  const tab = (id, ic, label) => `<button class="nav-tab ${state.view === id ? "active" : ""}" data-view="${id}">${icon(ic, "i sm")}${label}</button>`;
  return `
    <header class="topbar">
      <div class="brand"><span class="logo">${icon("mailOpen", "i sm")}</span><span class="bt">邮箱聚合平台</span></div>
      <nav class="nav-tabs">
        ${tab("inbox", "inbox", "统一收件箱")}
        ${tab("accounts", "users", "邮箱账户管理")}
        ${tab("import", "upload", "批量导入")}
      </nav>
      <div class="top-spacer"></div>
      <div class="field-search top-global-search">
        <span class="si">${icon("search", "i sm")}</span>
        <input class="input" id="global-search" placeholder="搜索邮件、账号…" value="${escapeHtml(state.view === "inbox" ? state.inboxQuery : state.acctQuery)}" />
      </div>
      ${state.view === "accounts" ? `<button class="btn primary" data-goto-import>${icon("upload", "i sm")}批量导入</button>` : ""}
    </header>`;
}

function renderView() {
  if (state.view === "inbox") return renderInbox();
  if (state.view === "accounts") return renderAccounts();
  if (state.view === "import") return renderImport();
  return "";
}

/* ============================================================
   统一收件箱
   ============================================================ */
function renderInbox() {
  const counts = {
    inbox: EMAILS.filter((m) => m.folder === "inbox").length,
    unread: EMAILS.filter((m) => m.folder === "inbox" && m.unread).length,
    starred: EMAILS.filter((m) => m.starred).length,
    sent: EMAILS.filter((m) => m.folder === "sent").length,
    drafts: EMAILS.filter((m) => m.folder === "drafts").length,
  };
  const list = folderEmails();
  const sel = selectedMail();
  return `
    <div class="inbox ${sel ? "reading" : ""}">
      ${renderInboxNav(counts)}
      ${renderInboxList(list)}
      ${renderInboxRead(sel)}
    </div>`;
}

function renderInboxNav(counts) {
  const navItem = (folder, ic, label, count) => `
    <button class="nav-item ${state.folder === folder ? "active" : ""}" data-folder="${folder}">
      <span class="ni-ic">${icon(ic, "i sm")}</span>
      <span class="ni-label">${label}</span>
      ${count != null ? `<span class="ni-count">${count}</span>` : ""}
    </button>`;

  const favs = ACCOUNTS.filter((a) => a.favorite);
  const recents = ACCOUNTS.filter((a) => a.recent);
  const mbBtn = (a) => `
    <button class="nav-item nav-mb" data-mb="${a.id}">
      <span class="av" style="background:${providerColor(a.hue)}">${escapeHtml(initials(a.email))}</span>
      <span class="ni-label">${escapeHtml(a.email)}</span>
      ${a.unread ? `<span class="ni-count">${a.unread}</span>` : ""}
    </button>`;

  return `
    <aside class="ibnav">
      <button class="btn primary mb-picker" style="width:100%;justify-content:center" data-open-picker>${icon("filter","i sm")}筛选邮箱${state.mailboxFilter.length ? ` · ${state.mailboxFilter.length}` : ""}</button>
      <div class="nav-group">
        ${navItem("inbox", "inbox", "统一收件箱", counts.unread || null)}
        ${navItem("starred", "star", "已加星标", counts.starred || null)}
        ${navItem("sent", "sent", "已发送", null)}
        ${navItem("drafts", "draft", "草稿", counts.drafts || null)}
      </div>
      <div class="nav-group">
        <h4>常用邮箱</h4>
        ${favs.slice(0, 5).map(mbBtn).join("")}
      </div>
      <div class="nav-group">
        <h4>最近使用</h4>
        ${recents.slice(0, 4).map(mbBtn).join("")}
      </div>
      <div class="nav-group nav-foot">
        ${navItem("__accounts", "users", "邮箱账户管理", ACCOUNTS.length)}
      </div>
    </aside>`;
}

function renderInboxList(list) {
  const chips = state.mailboxFilter.map((id) => {
    const a = ACCOUNTS.find((x) => x.id === id);
    if (!a) return "";
    return `<span class="filter-chip">${escapeHtml(a.email.split("@")[0])}<span class="x" data-remove-mb="${id}">${icon("x","i sm")}</span></span>`;
  }).join("");

  const rows = list.length
    ? list.map(renderMailRow).join("")
    : `<div class="empty-state"><div class="es-ic">${icon("mailOpen")}</div><div class="es-title">没有匹配的邮件</div><div>试试清空筛选或搜索</div></div>`;

  const folderLabel = { inbox: "统一收件箱", starred: "已加星标", sent: "已发送", drafts: "草稿" }[state.folder] || "收件箱";

  return `
    <section class="iblist">
      <div class="iblist-head">
        <span class="iblist-title">${folderLabel}</span>
        <span class="count-tag">${list.length} 封</span>
        <div class="iblist-tools">
          <button class="iconbtn" title="刷新">${icon("refresh","i sm")}</button>
          <button class="iconbtn" title="更多">${icon("more","i sm")}</button>
        </div>
      </div>
      ${state.mailboxFilter.length ? `<div class="filterbar">${chips}<button class="filter-clear" data-clear-mb>清除筛选</button></div>` : ""}
      <div class="iblist-search"><div class="field-search"><span class="si">${icon("search","i sm")}</span><input class="input" id="inbox-search" placeholder="在此文件夹中搜索" value="${escapeHtml(state.inboxQuery)}" /></div></div>
      <div class="list-scroll">${rows}</div>
    </section>`;
}

function renderMailRow(m) {
  const active = state.selectedMail === m.id;
  return `
    <div class="mrow ${m.unread ? "unread" : ""} ${active ? "active" : ""}" data-mail="${m.id}">
      <span class="accent-edge"></span>
      <div class="mrow-in">
        <div class="mrow-l1">
          <span class="unread-dot ${m.unread ? "" : "hidden"}"></span>
          <span class="mrow-from">${escapeHtml(m.from)}</span>
          <span class="mrow-time">${escapeHtml(m.time)}</span>
        </div>
        <div class="mrow-subj">${escapeHtml(m.subject)}</div>
        <div class="mrow-snip">${escapeHtml(m.snippet)}</div>
        <div class="mrow-l3">
          <span class="mb-tag"><span class="mb-dot" style="background:${providerColor(m.accountHue)}"></span><span class="mb-email">${escapeHtml(m.accountEmail)}</span></span>
          <span class="pill">${escapeHtml(m.groupName)}</span>
          <span class="mrow-icons">
            ${m.code ? `<span class="code-badge">验证码</span>` : ""}
            ${m.important ? `<span class="imp" title="重要">${icon("star","i sm")}</span>` : ""}
            ${m.hasAttachment ? `<span title="附件">${icon("attach","i sm")}</span>` : ""}
            ${m.starred ? `<span class="on" title="星标">${icon("star","i sm")}</span>` : ""}
          </span>
        </div>
      </div>
    </div>`;
}

function renderInboxRead(m) {
  if (!m) {
    return `<section class="ibread"><div class="empty-state" style="margin:auto"><div class="es-ic">${icon("mailOpen")}</div><div class="es-title">选择一封邮件查看</div><div>邮件正文将显示在这里</div></div></section>`;
  }
  return `
    <section class="ibread">
      <div class="read-toolbar">
        <button class="btn ghost narrow-only" data-back-list>${icon("chevronLeft","i sm")}返回</button>
        <button class="btn" data-reply>${icon("reply","i sm")}回复</button>
        <button class="btn ghost" data-toast="已转发（演示）">${icon("forward","i sm")}转发</button>
        <span class="sep"></span>
        <button class="iconbtn" title="归档" data-toast="已归档（演示）">${icon("archive","i sm")}</button>
        <button class="iconbtn" title="删除" data-toast="已删除（演示）">${icon("trash","i sm")}</button>
        <button class="iconbtn" title="星标" data-star-read="${m.id}">${icon("star","i sm")}</button>
        <span class="spacer"></span>
        <button class="iconbtn" title="更多">${icon("more","i sm")}</button>
      </div>
      <div class="read-scroll">
        <h1 class="read-subj">${escapeHtml(m.subject)}</h1>
        <div class="read-meta">
          <span class="read-av av" style="background:${providerColor(m.accountHue)}">${escapeHtml(initials(m.from))}</span>
          <div>
            <div class="read-from-name">${escapeHtml(m.from)}</div>
            <div class="read-from-addr">${escapeHtml(m.fromAddr)} · ${escapeHtml(m.time)}</div>
          </div>
          <div class="read-mb">
            <span class="mb-tag"><span class="mb-dot" style="background:${providerColor(m.accountHue)}"></span>收于 ${escapeHtml(m.accountEmail)}</span>
          </div>
        </div>
        ${m.code ? `<div class="code-callout"><span class="cval">${escapeHtml(m.code)}</span><span class="cmeta">检测到验证码 · 点击右侧复制</span><button class="btn" data-copy="${escapeHtml(m.code)}">${icon("clipboard","i sm")}复制</button></div>` : ""}
        <div class="read-body">${escapeHtml(m.body)}</div>
      </div>
    </section>`;
}

function bindInbox() {
  document.querySelectorAll("[data-folder]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.folder === "__accounts") { go("accounts"); return; }
    state.folder = b.dataset.folder; state.selectedMail = null; render();
  }));
  document.querySelectorAll("[data-mb]").forEach((b) => b.addEventListener("click", () => {
    toggleMailbox(b.dataset.mb); render();
  }));
  document.querySelectorAll("[data-mail]").forEach((r) => r.addEventListener("click", () => {
    const m = EMAILS.find((x) => x.id === r.dataset.mail); if (m) m.unread = false;
    state.selectedMail = r.dataset.mail; render();
  }));
  document.querySelector("#inbox-search")?.addEventListener("input", (e) => {
    state.inboxQuery = e.target.value; const p = e.target.selectionStart;
    render(); const el = document.querySelector("#inbox-search"); if (el) { el.focus(); el.setSelectionRange(p, p); }
  });
  document.querySelector("[data-open-picker]")?.addEventListener("click", (e) => { openMailboxPicker(e.currentTarget); });
  document.querySelector("[data-clear-mb]")?.addEventListener("click", () => { state.mailboxFilter = []; render(); });
  document.querySelectorAll("[data-remove-mb]").forEach((b) => b.addEventListener("click", () => { toggleMailbox(b.dataset.removeMb); render(); }));
  document.querySelector("[data-back-list]")?.addEventListener("click", () => { state.selectedMail = null; render(); });
  document.querySelector("[data-reply]")?.addEventListener("click", () => openReply());
  document.querySelector("[data-star-read]")?.addEventListener("click", (e) => { const m = EMAILS.find((x) => x.id === e.currentTarget.dataset.starRead); if (m) m.starred = !m.starred; render(); });
  document.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => { navigator.clipboard?.writeText(b.dataset.copy).catch(()=>{}); toast(`已复制验证码 ${b.dataset.copy}`); }));
  document.querySelectorAll("[data-toast]").forEach((b) => b.addEventListener("click", () => toast(b.dataset.toast)));
}

function toggleMailbox(id) {
  const i = state.mailboxFilter.indexOf(id);
  if (i >= 0) state.mailboxFilter.splice(i, 1); else state.mailboxFilter.push(id);
  state.selectedMail = null;
}

/* ============================================================
   邮箱账户管理
   ============================================================ */
function renderAccounts() {
  const counts = statusCounts();
  const filtered = filteredAccounts();
  const totalPages = Math.max(1, Math.ceil(filtered.length / state.acctPageSize));
  state.acctPage = Math.min(state.acctPage, totalPages);
  const start = (state.acctPage - 1) * state.acctPageSize;
  const pageRows = filtered.slice(start, start + state.acctPageSize);

  const seg = (key, label, val, tone) => `
    <button class="stat-seg ${state.acctStatus === key ? "active" : ""}" data-status="${key}">
      ${tone ? `<span class="dot" style="background:var(--${tone})"></span>` : ""}
      ${label} <span class="sv">${val}</span>
    </button>`;

  return `
    <div class="mgmt">
      <div class="mgmt-head">
        <div class="mgmt-title-row">
          <div>
            <div class="mgmt-title">邮箱账户管理</div>
            <div class="mgmt-sub">管理已导入的邮箱账号、连接状态与分组</div>
          </div>
          <div class="spacer"></div>
          <button class="btn primary" data-goto-import>${icon("upload","i sm")}批量导入</button>
        </div>
        <div class="stat-overview">
          ${seg("all", "全部", counts.all, null)}
          ${seg("normal", "正常", counts.normal, "ok")}
          ${seg("syncing", "同步中", counts.syncing, "info")}
          ${seg("needs_auth", "需授权", counts.needs_auth, "warn")}
          ${seg("failed", "连接失败", counts.failed, "danger")}
        </div>
      </div>

      <div class="mgmt-toolbar">
        <div class="field-search grow"><span class="si">${icon("search","i sm")}</span><input class="input" id="acct-search" placeholder="搜索邮箱地址、分组、服务商" value="${escapeHtml(state.acctQuery)}" /></div>
        <select class="select" id="acct-provider">
          <option value="all">全部服务商</option>
          ${PROVIDERS.map((p) => `<option value="${p.id}" ${state.acctProvider === p.id ? "selected" : ""}>${p.name}</option>`).join("")}
        </select>
        <select class="select" id="acct-group">
          <option value="all">全部分组</option>
          ${GROUPS.map((g) => `<option value="${g.id}" ${state.acctGroup === g.id ? "selected" : ""}>${g.name}</option>`).join("")}
        </select>
        <span class="result-count">${filtered.length} 个结果</span>
      </div>

      ${state.checked.size ? renderBatchBar() : ""}

      <div class="table-wrap">
        ${state.loading ? renderTableSkeleton() : renderTable(pageRows, filtered)}
      </div>

      ${renderPager(filtered.length, totalPages, start, pageRows.length)}
    </div>`;
}

function renderBatchBar() {
  return `
    <div class="batch-bar">
      <span class="bcount">已选 ${state.checked.size} 个账号</span>
      <span class="sep"></span>
      <button class="btn sm">${icon("refresh","i sm")}重新同步</button>
      <button class="btn sm">${icon("key","i sm")}重新授权</button>
      <button class="btn sm">分组</button>
      <button class="btn sm danger" data-batch-delete>${icon("trash","i sm")}删除</button>
      <span class="spacer"></span>
      <button class="btn sm ghost" data-clear-checked>取消选择</button>
    </div>`;
}

function sortArrow(key) {
  if (state.acctSort.key !== key) return "";
  return `<span class="arrow">${state.acctSort.dir === "asc" ? "↑" : "↓"}</span>`;
}

function renderTable(rows, filtered) {
  if (!filtered.length) {
    return `<div class="empty-state"><div class="es-ic">${icon("users")}</div><div class="es-title">没有符合条件的账号</div><div>调整筛选条件，或清除搜索关键字</div></div>`;
  }
  const allChecked = rows.length && rows.every((a) => state.checked.has(a.id));
  return `
    <table class="acct">
      <thead>
        <tr>
          <th class="col-check"><input type="checkbox" class="row-cbx" id="check-all" ${allChecked ? "checked" : ""}></th>
          <th class="sortable" data-sort="email">邮箱地址 ${sortArrow("email")}</th>
          <th class="sortable" data-sort="providerName">服务商 ${sortArrow("providerName")}</th>
          <th class="sortable" data-sort="groupName">分组 ${sortArrow("groupName")}</th>
          <th class="sortable" data-sort="status">状态 ${sortArrow("status")}</th>
          <th class="sortable" data-sort="unread">未读 ${sortArrow("unread")}</th>
          <th class="sortable" data-sort="lastSync">最近同步 ${sortArrow("lastSync")}</th>
          <th class="col-actions"></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(renderAcctRow).join("")}
      </tbody>
    </table>`;
}

function renderAcctRow(a) {
  const meta = STATUS_META[a.status];
  const checked = state.checked.has(a.id);
  const statusCell = a.status === "syncing"
    ? `<span class="status tone-info"><span class="dot sync"></span>同步中</span>`
    : `<span class="status tone-${meta.tone}"><span class="dot"></span>${meta.label}</span>`;
  return `
    <tr class="${checked ? "sel" : ""}" data-row="${a.id}">
      <td class="col-check"><input type="checkbox" class="row-cbx" data-check="${a.id}" ${checked ? "checked" : ""}></td>
      <td>
        <div class="td-email">
          <span class="av" style="background:${providerColor(a.hue)}">${escapeHtml(initials(a.email))}</span>
          <span class="em">${escapeHtml(a.email)}</span>
        </div>
        ${a.error ? `<div class="td-err">${escapeHtml(a.error)}</div>` : ""}
      </td>
      <td>${escapeHtml(a.providerName)}</td>
      <td><span class="pill">${escapeHtml(a.groupName)}</span></td>
      <td>${statusCell}</td>
      <td class="td-mono"><span class="td-unread-badge ${a.unread ? "" : "zero"}">${a.unread}</span></td>
      <td class="td-mono" style="color:var(--text-2)">${escapeHtml(a.lastSync)}</td>
      <td class="col-actions"><button class="iconbtn" data-row-more="${a.id}" title="更多">${icon("more","i sm")}</button></td>
    </tr>`;
}

function renderTableSkeleton() {
  const row = `<tr>${Array.from({length:8}).map((_,i)=>`<td>${i===0?"":`<div class="sk" style="height:14px;width:${[0,70,50,40,45,30,55,10][i]}%"></div>`}</td>`).join("")}</tr>`;
  return `<table class="acct"><tbody>${row.repeat(12)}</tbody></table>`;
}

function renderPager(total, totalPages, start, shown) {
  const nums = [];
  const cur = state.acctPage;
  const push = (n) => nums.push(`<button class="btn sm pnum ${n === cur ? "active" : ""}" data-page="${n}">${n}</button>`);
  for (let n = 1; n <= totalPages; n++) {
    if (n === 1 || n === totalPages || Math.abs(n - cur) <= 1) push(n);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  return `
    <div class="pager">
      <span class="pinfo">显示 ${total ? start + 1 : 0}–${start + shown} 共 ${total}</span>
      <span class="spacer"></span>
      <label style="font-size:12px;color:var(--text-3)">每页
        <select class="select" id="page-size" style="height:26px;margin-left:6px">
          ${[25,50,100].map((n)=>`<option value="${n}" ${state.acctPageSize===n?"selected":""}>${n}</option>`).join("")}
        </select>
      </label>
      <button class="btn sm pnum" data-page="${Math.max(1,cur-1)}" ${cur===1?"disabled":""}>${icon("chevronLeft","i sm")}</button>
      ${nums.map((n)=> n==="…" ? `<span style="color:var(--text-3)">…</span>` : n).join("")}
      <button class="btn sm pnum" data-page="${Math.min(totalPages,cur+1)}" ${cur===totalPages?"disabled":""}>${icon("chevronRight","i sm")}</button>
    </div>`;
}

function bindAccounts() {
  document.querySelector("#acct-search")?.addEventListener("input", (e) => {
    state.acctQuery = e.target.value; state.acctPage = 1; const p = e.target.selectionStart;
    render(); const el = document.querySelector("#acct-search"); if (el) { el.focus(); el.setSelectionRange(p, p); }
  });
  document.querySelectorAll("[data-status]").forEach((b) => b.addEventListener("click", () => { state.acctStatus = b.dataset.status; state.acctPage = 1; render(); }));
  document.querySelector("#acct-provider")?.addEventListener("change", (e) => { state.acctProvider = e.target.value; state.acctPage = 1; render(); });
  document.querySelector("#acct-group")?.addEventListener("change", (e) => { state.acctGroup = e.target.value; state.acctPage = 1; render(); });
  document.querySelectorAll("[data-sort]").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.sort;
    if (state.acctSort.key === k) state.acctSort.dir = state.acctSort.dir === "asc" ? "desc" : "asc";
    else state.acctSort = { key: k, dir: "asc" };
    render();
  }));
  document.querySelector("#check-all")?.addEventListener("change", (e) => {
    const rows = filteredAccounts().slice((state.acctPage-1)*state.acctPageSize, state.acctPage*state.acctPageSize);
    if (e.target.checked) rows.forEach((a) => state.checked.add(a.id));
    else rows.forEach((a) => state.checked.delete(a.id));
    render();
  });
  document.querySelectorAll("[data-check]").forEach((c) => c.addEventListener("change", (e) => {
    e.stopPropagation();
    if (c.checked) state.checked.add(c.dataset.check); else state.checked.delete(c.dataset.check);
    render();
  }));
  document.querySelectorAll("[data-row]").forEach((tr) => tr.addEventListener("click", (e) => {
    if (e.target.closest("input") || e.target.closest("button")) return;
    const id = tr.dataset.row;
    if (state.checked.has(id)) state.checked.delete(id); else state.checked.add(id);
    render();
  }));
  document.querySelector("[data-clear-checked]")?.addEventListener("click", () => { state.checked.clear(); render(); });
  document.querySelector("[data-batch-delete]")?.addEventListener("click", () => openDeleteModal());
  document.querySelectorAll("[data-page]").forEach((b) => b.addEventListener("click", () => { state.acctPage = Number(b.dataset.page); render(); }));
  document.querySelector("#page-size")?.addEventListener("change", (e) => { state.acctPageSize = Number(e.target.value); state.acctPage = 1; render(); });
  document.querySelectorAll("[data-row-more]").forEach((b) => b.addEventListener("click", () => toast("行操作菜单（演示）：重新同步 / 重新授权 / 移动分组 / 删除")));
  document.querySelectorAll("[data-goto-import]").forEach((b) => b.addEventListener("click", () => go("import")));
}

/* ============================================================
   批量导入向导
   ============================================================ */
const STEPS = ["选择方式", "数据预览", "确认导入", "导入进度", "导入结果"];
const IMPORT_STATS = { total: 128, valid: 112, dup: 9, err: 5, missing: 2, groups: 3 };
const PREVIEW_ROWS = [
  { line: 1, email: "grace.park@outlook.com", tag: "ok", note: "工作" },
  { line: 2, email: "leo.chen@hotmail.com", tag: "ok", note: "工作" },
  { line: 3, email: "maya.silva@gmail.com", tag: "dup", note: "已存在，将跳过" },
  { line: 4, email: "noah@live", tag: "err", note: "邮箱格式不正确" },
  { line: 5, email: "paula.rossi@outlook.com", tag: "ok", note: "客户 A" },
  { line: 6, email: "（缺少 refresh_token）", tag: "err", note: "缺少必填字段" },
  { line: 7, email: "quinn.tan@yahoo.com", tag: "ok", note: "个人" },
];

function renderImport() {
  return `
    <div class="import">
      <div class="import-head">
        <div class="import-title">批量导入邮箱</div>
        <div class="stepper">
          ${STEPS.map((s, i) => {
            const n = i + 1;
            const cls = n < state.step ? "done" : n === state.step ? "current" : "";
            return `<div class="step ${cls}"><span class="num">${n < state.step ? icon("check","i sm") : n}</span><span class="slabel">${s}</span></div>${i < STEPS.length-1 ? `<span class="line"></span>` : ""}`;
          }).join("")}
        </div>
      </div>
      <div class="import-body"><div class="import-panel">${renderImportStep()}</div></div>
      ${renderImportFoot()}
    </div>`;
}

function renderImportStep() {
  if (state.step === 1) {
    const method = (id, ic, title, desc) => `
      <button class="method ${state.importMethod === id ? "active" : ""}" data-method="${id}">
        <span class="m-ic">${icon(ic,"i sm")}</span>
        <span><span class="m-title">${title}</span><span class="m-desc">${desc}</span></span>
      </button>`;
    return `
      <div class="panel-card">
        <div class="pc-head">选择导入方式</div>
        <div class="pc-body">
          <div class="method-grid">
            ${method("csv", "file", "上传 CSV", "含 email、client_id、refresh_token 表头")}
            ${method("txt", "file", "上传 TXT", "每行一条：email----client_id----token")}
            ${method("paste", "clipboard", "粘贴多行数据", "直接粘贴多行凭证")}
            ${method("manual", "edit", "手动添加", "逐个填写单个账号")}
          </div>
          <div style="margin-top:14px">
            ${state.importMethod === "paste"
              ? `<textarea class="paste" placeholder="email----client_id----refresh_token\nname@outlook.com----xxxxxxxx-xxxx----0.A...">grace.park@outlook.com----9f3c1a20-demo----0.AFAKE1\nleo.chen@hotmail.com----7b1d22e0-demo----0.AFAKE2\nmaya.silva@gmail.com----2c9a41f0-demo----0.AFAKE3\n…（演示数据，共 128 行）</textarea>`
              : (state.importMethod === "manual"
                ? `<div style="display:grid;gap:8px;max-width:420px"><input class="input" placeholder="邮箱地址"><input class="input" placeholder="Client ID"><input class="input" placeholder="Refresh Token"></div>`
                : `<div class="dropzone">${icon("upload")}<div style="margin-top:8px"><strong>拖拽文件到此处</strong> 或点击选择</div><div style="margin-top:2px">已选择演示文件：<strong>accounts-128.${state.importMethod}</strong></div></div>`)}
          </div>
        </div>
      </div>`;
  }
  if (state.step === 2) {
    return `
      <div class="panel-card">
        <div class="pc-head">数据预览</div>
        <div class="pc-body">
          <div class="preview-stats">
            <div class="pv-cell"><div class="pv-num">${IMPORT_STATS.total}</div><div class="pv-label">总行数</div></div>
            <div class="pv-cell ok"><div class="pv-num">${IMPORT_STATS.valid}</div><div class="pv-label">有效账号</div></div>
            <div class="pv-cell warn"><div class="pv-num">${IMPORT_STATS.dup}</div><div class="pv-label">重复账号</div></div>
            <div class="pv-cell danger"><div class="pv-num">${IMPORT_STATS.err}</div><div class="pv-label">格式错误</div></div>
            <div class="pv-cell danger"><div class="pv-num">${IMPORT_STATS.missing}</div><div class="pv-label">缺少字段</div></div>
          </div>
          <div style="margin-top:10px;font-size:12px;color:var(--text-2)">将自动创建 <strong>${IMPORT_STATS.groups}</strong> 个新分组：工作、客户 A、个人</div>
        </div>
      </div>
      <div class="panel-card">
        <div class="pc-head">逐行校验（前 7 行）</div>
        <div class="pc-body" style="padding-top:4px">
          <table class="preview-table">
            <thead><tr><th style="width:44px">行</th><th>邮箱</th><th style="width:80px">状态</th><th>说明</th></tr></thead>
            <tbody>
              ${PREVIEW_ROWS.map((r) => `<tr><td class="td-mono">${r.line}</td><td class="${r.tag==="err"?"bad":""}">${escapeHtml(r.email)}</td><td><span class="row-tag ${r.tag}">${r.tag==="ok"?"有效":r.tag==="dup"?"重复":"错误"}</span></td><td style="color:var(--text-3)">${escapeHtml(r.note)}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>`;
  }
  if (state.step === 3) {
    const willImport = state.importSkipDup ? IMPORT_STATS.valid : IMPORT_STATS.valid + IMPORT_STATS.dup;
    const willSkip = IMPORT_STATS.err + IMPORT_STATS.missing + (state.importSkipDup ? IMPORT_STATS.dup : 0);
    return `
      <div class="panel-card">
        <div class="pc-head">确认导入</div>
        <div class="pc-body">
          <div class="confirm-list">
            <div class="confirm-row"><div><div class="cr-main">将导入 <strong>${willImport}</strong> 个账号</div><div class="cr-sub">有效账号${state.importSkipDup ? "" : " + 重复账号"}</div></div><span class="status tone-ok"><span class="dot"></span>就绪</span></div>
            <div class="confirm-row"><div><div class="cr-main">将跳过 <strong>${willSkip}</strong> 项</div><div class="cr-sub">格式错误 ${IMPORT_STATS.err} + 缺少字段 ${IMPORT_STATS.missing}${state.importSkipDup ? ` + 重复 ${IMPORT_STATS.dup}` : ""}</div></div><span class="status tone-warn"><span class="dot"></span>跳过</span></div>
            <div class="confirm-row"><div><div class="cr-main">跳过重复账号</div><div class="cr-sub">已存在的邮箱不再重复导入</div></div><button class="toggle ${state.importSkipDup ? "on" : ""}" data-toggle="skipDup"></button></div>
            <div class="confirm-row"><div><div class="cr-main">导入后模拟连接测试</div><div class="cr-sub">尝试验证凭证是否可用（演示，不连真实服务器）</div></div><button class="toggle ${state.importSimulate ? "on" : ""}" data-toggle="simulate"></button></div>
          </div>
        </div>
      </div>`;
  }
  if (state.step === 4) {
    const total = state.importSkipDup ? IMPORT_STATS.valid : IMPORT_STATS.valid + IMPORT_STATS.dup;
    const done = Math.round(total * state.progress / 100);
    const failed = Math.round(done * 0.05);
    const success = done - failed;
    const waiting = total - done;
    return `
      <div class="panel-card">
        <div class="pc-head">导入进度</div>
        <div class="pc-body">
          <div class="progress-big"><div class="progress-num">${state.progress}%</div><div class="progress-caption">正在导入 ${total} 个账号…（汇总进度，不逐条提示）</div></div>
          <div class="progress-track"><div class="progress-fill" style="width:${state.progress}%"></div></div>
          <div class="progress-breakdown">
            <div class="pb-cell"><div class="pb-num" style="color:var(--ok)">${success}</div><div class="pb-label">成功</div></div>
            <div class="pb-cell"><div class="pb-num" style="color:var(--danger)">${failed}</div><div class="pb-label">失败</div></div>
            <div class="pb-cell"><div class="pb-num" style="color:var(--text-3)">${waiting}</div><div class="pb-label">等待</div></div>
          </div>
          <div class="now-processing">${state.progress < 100 ? `<span class="dot sync" style="background:var(--info)"></span>正在处理：${escapeHtml((ACCOUNTS[done] || ACCOUNTS[0]).email)}` : `${icon("check","i sm")}全部处理完成`}</div>
        </div>
      </div>`;
  }
  // step 5
  const total = state.importSkipDup ? IMPORT_STATS.valid : IMPORT_STATS.valid + IMPORT_STATS.dup;
  const failed = Math.round(total * 0.05);
  const success = total - failed;
  return `
    <div class="panel-card">
      <div class="pc-body">
        <div class="result-hero">
          <div class="result-check">${icon("check")}</div>
          <div class="result-title">导入完成</div>
          <div class="result-sub">共处理 ${total} 个账号，成功 ${success} 个，失败 ${failed} 个</div>
        </div>
        <div class="progress-breakdown" style="max-width:460px;margin:16px auto 0">
          <div class="pb-cell"><div class="pb-num" style="color:var(--ok)">${success}</div><div class="pb-label">成功导入</div></div>
          <div class="pb-cell"><div class="pb-num" style="color:var(--danger)">${failed}</div><div class="pb-label">导入失败</div></div>
          <div class="pb-cell"><div class="pb-num">${IMPORT_STATS.err + IMPORT_STATS.missing}</div><div class="pb-label">已跳过</div></div>
        </div>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:20px">
          <button class="btn primary" data-goto-accounts>${icon("users","i sm")}进入账户管理</button>
          <button class="btn" data-toast="错误报告已下载（演示）">${icon("download","i sm")}下载错误报告</button>
        </div>
      </div>
    </div>`;
}

function renderImportFoot() {
  if (state.step === 4) {
    return `<div class="import-foot"><span style="font-size:12px;color:var(--text-3)">导入过程中可离开此页，任务将在后台继续（演示）</span><div class="spacer"></div>${state.progress >= 100 ? `<button class="btn primary" data-import-next>查看结果</button>` : `<button class="btn" data-import-cancel>取消导入</button>`}</div>`;
  }
  if (state.step === 5) {
    return `<div class="import-foot"><button class="btn ghost" data-import-restart>再次导入</button><div class="spacer"></div></div>`;
  }
  return `
    <div class="import-foot">
      ${state.step > 1 ? `<button class="btn" data-import-back>${icon("chevronLeft","i sm")}上一步</button>` : `<button class="btn" data-goto-accounts>取消</button>`}
      <div class="spacer"></div>
      <span style="font-size:12px;color:var(--text-3)">${state.step === 2 ? `${IMPORT_STATS.valid} 个有效 · ${IMPORT_STATS.dup} 重复 · ${IMPORT_STATS.err + IMPORT_STATS.missing} 错误` : ""}</span>
      <button class="btn primary" data-import-next>${state.step === 3 ? "开始导入" : "下一步"}${icon("chevronRight","i sm")}</button>
    </div>`;
}

function bindImport() {
  document.querySelectorAll("[data-method]").forEach((b) => b.addEventListener("click", () => { state.importMethod = b.dataset.method; render(); }));
  document.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", () => { const k = b.dataset.toggle === "skipDup" ? "importSkipDup" : "importSimulate"; state[k] = !state[k]; render(); }));
  document.querySelector("[data-import-back]")?.addEventListener("click", () => { state.step = Math.max(1, state.step - 1); render(); });
  document.querySelector("[data-import-next]")?.addEventListener("click", () => {
    if (state.step === 3) { state.step = 4; state.progress = 0; render(); runImportProgress(); return; }
    if (state.step === 4) { state.step = 5; render(); return; }
    state.step = Math.min(5, state.step + 1); render();
  });
  document.querySelector("[data-import-cancel]")?.addEventListener("click", () => { stopImportProgress(); state.step = 3; render(); toast("已取消导入"); });
  document.querySelector("[data-import-restart]")?.addEventListener("click", () => { state.step = 1; state.progress = 0; render(); });
  document.querySelectorAll("[data-goto-accounts]").forEach((b) => b.addEventListener("click", () => go("accounts")));
  document.querySelectorAll("[data-toast]").forEach((b) => b.addEventListener("click", () => toast(b.dataset.toast)));
}

let importTimer = null;
function runImportProgress() {
  stopImportProgress();
  importTimer = setInterval(() => {
    state.progress = Math.min(100, state.progress + 4 + Math.round(Math.random() * 6));
    if (state.view === "import" && state.step === 4) render();
    if (state.progress >= 100) { stopImportProgress(); }
  }, 260);
}
function stopImportProgress() { if (importTimer) { clearInterval(importTimer); importTimer = null; } }

/* ============================================================
   layer: popover / modal / toast
   ============================================================ */
function renderLayer() {
  let html = "";
  if (state.popover === "mailbox") html += renderMailboxPicker();
  if (state.modal) html += state.modal;
  html += `<div class="toast-wrap">${state.toasts.map((t) => `<div class="toast">${escapeHtml(t.msg)}${t.action ? `<span class="t-action" data-toast-action="${t.id}">${escapeHtml(t.action)}</span>` : ""}</div>`).join("")}</div>`;
  layer.innerHTML = html;
  bindLayer();
}

function renderMailboxPicker() {
  const q = state.popoverQuery.trim().toLowerCase();
  const match = (a) => !q || a.email.toLowerCase().includes(q);
  const favs = ACCOUNTS.filter((a) => a.favorite && match(a));
  const recents = ACCOUNTS.filter((a) => a.recent && match(a));
  const others = ACCOUNTS.filter((a) => !a.favorite && !a.recent && match(a)).slice(0, 40);
  const item = (a) => `
    <div class="pop-item ${state.mailboxFilter.includes(a.id) ? "on" : ""}" data-pick-mb="${a.id}">
      <span class="av" style="background:${providerColor(a.hue)};width:18px;height:18px;border-radius:4px;font-size:9px">${escapeHtml(initials(a.email))}</span>
      <span class="pi-email">${escapeHtml(a.email)}</span>
      <span class="pi-check">${icon("check","i sm")}</span>
    </div>`;
  const pos = state._pickerPos || { top: 92, left: 12 };
  return `
    <div class="popover" style="top:${pos.top}px;left:${pos.left}px" id="mb-popover">
      <div class="pop-search"><div class="field-search"><span class="si">${icon("search","i sm")}</span><input class="input" id="mb-pop-search" placeholder="搜索邮箱（共 ${ACCOUNTS.length} 个）" value="${escapeHtml(state.popoverQuery)}" autofocus></div></div>
      <div class="pop-list">
        ${favs.length ? `<div class="pop-section">常用</div>${favs.map(item).join("")}` : ""}
        ${recents.length ? `<div class="pop-section">最近使用</div>${recents.map(item).join("")}` : ""}
        ${others.length ? `<div class="pop-section">全部邮箱</div>${others.map(item).join("")}` : ""}
        ${!favs.length && !recents.length && !others.length ? `<div class="pop-section">无匹配</div>` : ""}
      </div>
    </div>`;
}

function openMailboxPicker(btn) {
  const r = btn.getBoundingClientRect();
  state._pickerPos = { top: r.bottom + 6, left: r.left };
  state.popover = state.popover === "mailbox" ? null : "mailbox";
  state.popoverQuery = "";
  renderLayer();
}

function openDeleteModal() {
  const ids = [...state.checked];
  const emails = ACCOUNTS.filter((a) => ids.includes(a.id)).map((a) => a.email);
  state.modal = `
    <div class="overlay" data-overlay>
      <div class="modal">
        <div class="modal-head">删除 ${ids.length} 个账号？</div>
        <div class="modal-body">
          此操作将永久移除以下账号的凭证，且不可恢复。
          <div class="del-list">${emails.slice(0, 8).map((e) => `<div>${escapeHtml(e)}</div>`).join("")}${emails.length > 8 ? `<div style="color:var(--text-3)">…及其余 ${emails.length - 8} 个</div>` : ""}</div>
        </div>
        <div class="modal-foot">
          <button class="btn" data-modal-cancel>取消</button>
          <button class="btn danger" data-modal-confirm-delete>删除 ${ids.length} 个</button>
        </div>
      </div>
    </div>`;
  renderLayer();
}

function openReply() {
  const m = selectedMail();
  state.modal = `
    <div class="overlay" data-overlay>
      <div class="modal" style="width:min(560px,100%)">
        <div class="modal-head">回复邮件</div>
        <div class="modal-body" style="display:grid;gap:10px;color:var(--text)">
          <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--warn-bg);border:1px solid color-mix(in srgb,var(--warn) 30%,transparent);border-radius:6px;font-size:12px;color:var(--warn)">${icon("key","i sm")} 发件账号：<strong>${escapeHtml(m ? m.accountEmail : "")}</strong>（请确认后再发送）</div>
          <input class="input" value="${m ? escapeHtml(m.fromAddr) : ""}" placeholder="收件人">
          <input class="input" value="${m ? "Re: " + escapeHtml(m.subject) : ""}" placeholder="主题">
          <textarea class="paste" style="font-family:var(--font);min-height:120px" placeholder="写点什么…"></textarea>
        </div>
        <div class="modal-foot">
          <button class="btn" data-modal-cancel>丢弃</button>
          <button class="btn primary" data-modal-save-draft>保存草稿</button>
        </div>
      </div>
    </div>`;
  renderLayer();
}

function bindLayer() {
  document.querySelector("#mb-pop-search")?.addEventListener("input", (e) => { state.popoverQuery = e.target.value; const p = e.target.selectionStart; renderLayer(); const el = document.querySelector("#mb-pop-search"); if (el) { el.focus(); el.setSelectionRange(p, p); } });
  document.querySelectorAll("[data-pick-mb]").forEach((b) => b.addEventListener("click", () => { toggleMailbox(b.dataset.pickMb); render(); renderLayer(); }));
  document.querySelector("[data-overlay]")?.addEventListener("click", (e) => { if (e.target.hasAttribute("data-overlay")) closeModal(); });
  document.querySelector("[data-modal-cancel]")?.addEventListener("click", closeModal);
  document.querySelector("[data-modal-confirm-delete]")?.addEventListener("click", () => {
    const n = state.checked.size;
    state.checked.clear(); closeModal(); render();
    toast(`已删除 ${n} 个账号`, "撤销");
  });
  document.querySelector("[data-modal-save-draft]")?.addEventListener("click", () => { closeModal(); toast("草稿已保存（演示不会真实发送）"); });
  document.querySelectorAll("[data-toast-action]").forEach((b) => b.addEventListener("click", () => { dismissToast(Number(b.dataset.toastAction)); toast("已撤销"); }));
}
// 单一持久监听：点击 popover 与触发按钮之外的区域时关闭（在 boot 时注册一次）
function onDocClickForPopover(e) {
  if (state.popover !== "mailbox") return;
  if (e.target.closest("#mb-popover") || e.target.closest("[data-open-picker]")) return;
  state.popover = null; renderLayer();
}

function closeModal() { state.modal = null; renderLayer(); }

let toastSeq = 0;
function toast(msg, action) {
  const id = ++toastSeq;
  state.toasts.push({ id, msg, action });
  renderLayer();
  setTimeout(() => dismissToast(id), 3200);
}
function dismissToast(id) { state.toasts = state.toasts.filter((t) => t.id !== id); renderLayer(); }

/* ---------------- router ---------------- */
let acctLoadTimer = null;
function maybeLoadAccounts() {
  if (state.view !== "accounts") return;
  state.loading = true;
  clearTimeout(acctLoadTimer);
  acctLoadTimer = setTimeout(() => { state.loading = false; if (state.view === "accounts") render(); }, 420);
}
function go(view) {
  const changed = state.view !== view;
  state.view = view;
  if (location.hash !== `#/${view}`) location.hash = `#/${view}`;
  if (changed && view === "accounts") maybeLoadAccounts();
  render();
}
function syncFromHash() {
  const v = (location.hash || "#/inbox").replace("#/", "");
  state.view = ["inbox", "accounts", "import"].includes(v) ? v : "inbox";
}
window.addEventListener("hashchange", () => { const prev = state.view; syncFromHash(); if (prev !== state.view && state.view === "accounts") maybeLoadAccounts(); render(); });

function bindTopbar() {
  document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => go(b.dataset.view)));
  document.querySelector("[data-goto-import]")?.addEventListener("click", () => go("import"));
  document.querySelector("#global-search")?.addEventListener("input", (e) => {
    const val = e.target.value; const p = e.target.selectionStart;
    if (state.view === "inbox") state.inboxQuery = val;
    else if (state.view === "accounts") { state.acctQuery = val; state.acctPage = 1; }
    render();
    const el = document.querySelector("#global-search"); if (el) { el.focus(); el.setSelectionRange(p, p); }
  });
}

/* ---------------- boot ---------------- */
document.addEventListener("mousedown", onDocClickForPopover);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (state.modal) { closeModal(); return; }
    if (state.popover) { state.popover = null; renderLayer(); }
  }
});
syncFromHash();
render();
