// 稳定的模拟数据 —— 全部为杜撰内容，不连接任何真实邮件服务，不含真实用户信息。
// 用确定性伪随机生成约 286 个账号，保证每次加载一致，便于演示与对比。

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260715);
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
function chance(p) { return rnd() < p; }

export const PROVIDERS = [
  { id: "outlook",  name: "Outlook",  domain: "outlook.com",   hue: 212 },
  { id: "hotmail",  name: "Hotmail",  domain: "hotmail.com",   hue: 224 },
  { id: "live",     name: "Live",     domain: "live.com",      hue: 200 },
  { id: "gmail",    name: "Gmail",    domain: "gmail.com",     hue: 4   },
  { id: "icloud",   name: "iCloud",   domain: "icloud.com",    hue: 205 },
  { id: "yahoo",    name: "Yahoo",    domain: "yahoo.com",     hue: 270 },
];

export const GROUPS = [
  { id: "work",    name: "工作" },
  { id: "personal",name: "个人" },
  { id: "commerce",name: "电商" },
  { id: "social",  name: "社交" },
  { id: "dev",     name: "开发" },
  { id: "clientA", name: "客户 A" },
  { id: "clientB", name: "客户 B" },
  { id: "backup",  name: "备用" },
];

// 状态：normal 正常 / syncing 同步中 / needs_auth 需授权 / failed 连接失败
export const STATUS_META = {
  normal:    { label: "正常",     tone: "ok" },
  syncing:   { label: "同步中",   tone: "info" },
  needs_auth:{ label: "需授权",   tone: "warn" },
  failed:    { label: "连接失败", tone: "danger" },
};

const FIRST = ["lena","mira","daniel","priya","antonio","sally","karen","john","yuki","omar","chloe","victor","nadia","felix","grace","hugo","ivy","leo","maya","noah","paula","quinn","rex","sara","theo","uma","wei","xena","yara","zack","alan","bella","cody","dora","evan","fiona","gary","hana","ian","june"];
const LAST = ["reed","morales","dixon","kelly","green","park","novak","silva","brooks","chen","dubois","ferro","gupta","hansen","ito","jones","khan","lopez","meyer","nash","ortiz","patel","rossi","tan","voss","wang","yost","zhao","adler","blum"];

function makeEmail(i) {
  const f = FIRST[i % FIRST.length];
  const l = LAST[(i * 7 + 3) % LAST.length];
  const p = PROVIDERS[(i * 3 + 1) % PROVIDERS.length];
  const style = i % 4;
  let local;
  if (style === 0) local = `${f}.${l}`;
  else if (style === 1) local = `${f}${l}${10 + (i % 89)}`;
  else if (style === 2) local = `${f}_${l}`;
  else local = `${f}.${l}.${(i % 30) + 1}`;
  return { local: local.toLowerCase(), domain: p.domain, provider: p };
}

// 生成账号总量：286 → 正常 241 / 同步中 12 / 需授权 18 / 失败 15
function buildStatusPool() {
  const pool = [];
  for (let i = 0; i < 241; i++) pool.push("normal");
  for (let i = 0; i < 12; i++) pool.push("syncing");
  for (let i = 0; i < 18; i++) pool.push("needs_auth");
  for (let i = 0; i < 15; i++) pool.push("failed");
  // 确定性打散
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

const ERRORS = {
  needs_auth: ["refresh token 已过期，需重新授权", "凭证已失效，请更新 refresh token", "授权被撤销，需重新登录"],
  failed: ["IMAP 连接超时", "TLS 握手失败", "服务商暂时限流（429）", "网络不可达"],
};

function relTime(minutesAgo) {
  if (minutesAgo < 1) return "刚刚";
  if (minutesAgo < 60) return `${Math.round(minutesAgo)} 分钟前`;
  if (minutesAgo < 60 * 24) return `${Math.round(minutesAgo / 60)} 小时前`;
  return `${Math.round(minutesAgo / 60 / 24)} 天前`;
}

const statusPool = buildStatusPool();

export const ACCOUNTS = statusPool.map((status, i) => {
  const e = makeEmail(i);
  const group = GROUPS[(i * 5 + 2) % GROUPS.length];
  const unread = status === "failed" ? 0 : Math.floor(rnd() * (status === "normal" ? 24 : 6));
  const syncedMin = status === "syncing" ? 0 : status === "failed" ? 60 * (2 + Math.floor(rnd() * 40)) : Math.floor(rnd() * 60 * 12);
  return {
    id: `acc${String(i + 1).padStart(3, "0")}`,
    email: `${e.local}@${e.domain}`,
    provider: e.provider.id,
    providerName: e.provider.name,
    hue: e.provider.hue,
    group: group.id,
    groupName: group.name,
    status,
    unread,
    lastSync: status === "syncing" ? "同步中…" : relTime(syncedMin),
    lastSyncMin: syncedMin,
    error: status === "needs_auth" ? pick(ERRORS.needs_auth) : status === "failed" ? pick(ERRORS.failed) : null,
    favorite: i < 6,
    recent: i >= 6 && i < 12,
  };
});

export function statusCounts() {
  const c = { all: ACCOUNTS.length, normal: 0, syncing: 0, needs_auth: 0, failed: 0 };
  for (const a of ACCOUNTS) c[a.status]++;
  return c;
}

// ---------------- 邮件（统一收件箱用） ----------------
// 手工撰写一批真实感邮件，绑定到部分账号，供三栏收件箱演示。

const byEmail = (needle) => ACCOUNTS.find((a) => a.email.startsWith(needle)) || ACCOUNTS[0];

const RAW_MAILS = [
  { acc: 0, from: "Daniel Whitfield", addr: "daniel@brightlabs.example", subject: "关于周四设计评审的两个待确认问题",
    snippet: "评审前想跟你对齐两点：导航层级与空状态文案，方便今天回复吗？", unread: true, star: true, attach: true, important: true, min: 18, folder: "inbox",
    body: "Lena 你好，\n\n周四的设计评审前，我想先跟你对齐两点：\n\n1. 顶部导航到底用两级还是三级？\n2. 空状态文案偏引导式还是极简式？\n\n附件是最新原型链接汇总。今天内给个方向即可。\n\n谢谢！\nDaniel" },
  { acc: 1, from: "财务共享中心", addr: "billing@company.example", subject: "【待处理】7 月报销单据需在 7/18 前补交发票",
    snippet: "一笔差旅报销 ¥1,240 缺少发票附件，逾期将退回。", unread: true, star: false, attach: false, important: true, min: 95, folder: "inbox",
    body: "您好，\n\n系统检测到您 7 月的报销单（BX-20260714-08，差旅 ¥1,240）缺少发票附件。\n\n请在 7 月 18 日前登录报销系统补交，逾期退回。\n\n财务共享中心" },
  { acc: 2, from: "Coursera", addr: "no-reply@coursera.example", subject: "你的登录验证码是 483920",
    snippet: "验证码 483920，5 分钟内有效。如非本人操作请忽略。", unread: true, star: false, attach: false, important: false, min: 6, folder: "inbox",
    body: "你好，\n\n你正在登录 Coursera。验证码：483920\n\n5 分钟内有效。如非本人操作请忽略。", code: "483920" },
  { acc: 0, from: "GitHub", addr: "notifications@github.example", subject: "[aurora-ui] Pull request #218 已被合并",
    snippet: "你的 PR「统一收件箱骨架屏」已被 mira-liu 合并到 main。", unread: true, star: false, attach: false, important: false, min: 160, folder: "inbox",
    body: "你好，\n\n你的 PR #218「统一收件箱骨架屏」已被 mira-liu 合并到 main 分支。\n\n查看变更：github.example/aurora-ui/pull/218" },
  { acc: 3, from: "Priya Anand", addr: "priya@vendor.example", subject: "Re: 下季度合作方案初稿",
    snippet: "已把定价页更新到 v3，你看下第 4 节还有没有要调整的。", unread: false, star: true, attach: true, important: false, min: 300, folder: "inbox",
    body: "Hi Lena,\n\n多谢反馈。定价页已更新到 v3，主要改了阶梯折扣。\n\n有空看下第 4 节，争取本周定稿。\n\nBest,\nPriya" },
  { acc: 4, from: "京东", addr: "verify@shop.example", subject: "【安全验证】验证码 902145",
    snippet: "您正在修改支付密码，验证码 902145，请勿泄露。", unread: true, star: false, attach: false, important: true, min: 40, folder: "inbox",
    body: "尊敬的用户，\n\n您正在修改支付密码。验证码：902145\n\n请勿泄露给他人。", code: "902145" },
  { acc: 2, from: "图书馆", addr: "library@university.example", subject: "借阅提醒：2 本书将于 7/20 到期",
    snippet: "《设计心理学》《信息架构》将于 7/20 到期，可在线续借。", unread: false, star: false, attach: false, important: false, min: 620, folder: "inbox",
    body: "同学你好，\n\n你借阅的《设计心理学》《信息架构》将于 7 月 20 日到期，可在线续借一次。" },
  { acc: 1, from: "Priya Anand", addr: "priya@vendor.example", subject: "会议纪要：合作对齐（7/14）",
    snippet: "附上今天对齐的纪要与 action items，请确认。", unread: false, star: false, attach: true, important: false, min: 720, folder: "inbox",
    body: "Hi，\n\n附上今天的会议纪要与 action items，请确认无误。\n\nPriya" },
  { acc: 5, from: "Notion", addr: "team@notion.example", subject: "本周产品更新：日历视图与数据库摘要",
    snippet: "日历视图上线，数据库支持摘要。点击查看变化。", unread: true, star: false, attach: false, important: false, min: 900, folder: "inbox",
    body: "本周我们上线了日历视图，并为数据库带来了摘要能力……" },
  { acc: 0, from: "日程助手", addr: "calendar@company.example", subject: "明日提醒：10:00 与设计团队站会",
    snippet: "明天上午 10:00「设计团队站会」，会议室 B2-04。", unread: false, star: false, attach: false, important: false, min: 200, folder: "inbox",
    body: "提醒：明天上午 10:00「设计团队站会」，地点 B2-04。" },
  { acc: 3, from: "LinkedIn", addr: "invite@linkedin.example", subject: "你有 3 条新的人脉推荐",
    snippet: "根据你的行业，为你推荐了 3 位可能认识的人。", unread: false, star: false, attach: false, important: false, min: 1500, folder: "inbox",
    body: "根据你的行业和联系人，为你推荐了 3 位你可能认识的人……" },
  { acc: 4, from: "Amazon", addr: "ship@amazon.example", subject: "你的订单已发货（含 2 件商品）",
    snippet: "预计 7/17 送达，点击查看物流详情。", unread: true, star: false, attach: false, important: false, min: 80, folder: "inbox",
    body: "你好，\n\n你的订单已发货，预计 7 月 17 日送达。\n\n查看物流：amazon.example/track" },
  { acc: 0, from: "Lena Morris", addr: "self@outlook.example", subject: "草稿：给团队的周报", snippet: "本周进展：完成收件箱重构一期……", unread: false, star: false, attach: false, important: false, min: 30, folder: "drafts",
    body: "本周进展：\n- 完成统一收件箱重构一期\n- 账户管理表格支持批量操作\n（草稿，未发送）" },
  { acc: 1, from: "Lena Morris", addr: "self@hotmail.example", subject: "已发送：报销发票补交说明", snippet: "已按要求补交发票，麻烦查收。", unread: false, star: false, attach: true, important: false, min: 50, folder: "sent",
    body: "你好，已按要求补交发票，麻烦查收。谢谢。" },
];

export const EMAILS = RAW_MAILS.map((m, i) => {
  const acc = ACCOUNTS[m.acc];
  return {
    id: `m${i + 1}`,
    accountId: acc.id,
    accountEmail: acc.email,
    accountHue: acc.hue,
    groupName: acc.groupName,
    from: m.from,
    fromAddr: m.addr,
    subject: m.subject,
    snippet: m.snippet,
    body: m.body,
    unread: m.unread,
    starred: m.star,
    hasAttachment: m.attach,
    important: m.important,
    code: m.code || null,
    folder: m.folder,
    minAgo: m.min,
    time: relTime(m.min),
  };
});

export function escapeHtml(v) {
  return String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
export function initials(name) {
  const parts = String(name || "?").trim().split(/[\s.@_]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return String(name || "?").slice(0, 2).toUpperCase();
}
export function providerColor(hue) { return `hsl(${hue} 55% 48%)`; }
