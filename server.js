import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { connect as tlsConnect } from "node:tls";
import { DatabaseSync } from "node:sqlite";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT || 1111);
const HOST = process.env.HOST || "127.0.0.1";
const DATA_DIR = join(__dirname, "data");
const DB_FILE = process.env.OAUTH_IMAP_DB || join(DATA_DIR, "oauth_imap_credentials.sqlite3");
const PUBLIC_DIR = join(__dirname, "public");
const TENANT_ID = process.env.MS_TENANT_ID || "common";
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
const TOKEN_SCOPE =
  process.env.MS_TOKEN_SCOPE || "https://outlook.office.com/IMAP.AccessAsUser.All offline_access";
const IMAP_HOST = process.env.MS_IMAP_HOST || "outlook.office365.com";
const IMAP_PORT = Number(process.env.MS_IMAP_PORT || 993);
const TOKEN_TIMEOUT_MS = Number(process.env.MS_TOKEN_TIMEOUT_MS || 20_000);
const IMAP_CONNECT_TIMEOUT_MS = Number(process.env.MS_IMAP_CONNECT_TIMEOUT_MS || 15_000);
const IMAP_COMMAND_TIMEOUT_MS = Number(process.env.MS_IMAP_COMMAND_TIMEOUT_MS || 25_000);
const FETCH_TIMEOUT_MS = Number(process.env.MS_FETCH_TIMEOUT_MS || 60_000);
const TOKEN_KEEPALIVE_INTERVAL_MS = Number(process.env.MS_TOKEN_KEEPALIVE_INTERVAL_MS || 6 * 60 * 60 * 1000);
const TOKEN_KEEPALIVE_START_DELAY_MS = Number(process.env.MS_TOKEN_KEEPALIVE_START_DELAY_MS || 30_000);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

await mkdir(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec(`
  CREATE TABLE IF NOT EXISTS credentials (
    email TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

function nowIso() {
  return new Date().toISOString();
}

function accountId(email) {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 18);
}

function jsonResponse(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function getBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 5_000_000) {
        req.destroy();
        reject(new Error("请求内容过大"));
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("请求不是有效 JSON"));
      }
    });
    req.on("error", reject);
  });
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parseCredentialText(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (!lines.length) return { rows: [], errors: [] };

  if (lines[0].includes("----")) return parseDelimited(lines);
  return parseCsvLines(lines);
}

function parseDelimited(lines) {
  const rows = [];
  const errors = [];
  for (const [index, line] of lines.entries()) {
    const parts = line.split("----").map((part) => part.trim());
    let row = null;

    if (parts.length === 3) {
      row = {
        email: parts[0],
        clientId: parts[1],
        refreshToken: parts[2],
      };
    } else if (parts.length >= 4) {
      row = {
        email: parts[0],
        clientId: parts[2],
        refreshToken: parts.slice(3).join("----"),
      };
    }

    if (!row) {
      errors.push({ line: index + 1, reason: "格式应为 email----client_id----refresh_token 或 email----备注----client_id----refresh_token" });
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
      errors.push({ line: index + 1, reason: "email 格式不正确" });
    } else if (!row.clientId || !row.refreshToken) {
      errors.push({ line: index + 1, reason: "client_id 和 refresh_token 不能为空" });
    } else {
      rows.push(row);
    }
  }
  return { rows, errors };
}

function parseCsvLines(lines) {
  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase());
  const indexes = {
    email: headers.indexOf("email"),
    clientId: headers.indexOf("client_id"),
    refreshToken: headers.indexOf("refresh_token"),
  };
  const missing = Object.entries(indexes)
    .filter(([, index]) => index < 0)
    .map(([name]) => name);
  if (missing.length) {
    return { rows: [], errors: [{ line: 1, reason: `缺少列：${missing.join(", ")}` }] };
  }

  const rows = [];
  const errors = [];
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const cells = parseCsvLine(lines[lineIndex]);
    const row = {
      email: String(cells[indexes.email] || "").trim(),
      clientId: String(cells[indexes.clientId] || "").trim(),
      refreshToken: String(cells[indexes.refreshToken] || "").trim(),
    };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
      errors.push({ line: lineIndex + 1, reason: "email 格式不正确" });
    } else if (!row.clientId || !row.refreshToken) {
      errors.push({ line: lineIndex + 1, reason: "client_id 和 refresh_token 不能为空" });
    } else {
      rows.push(row);
    }
  }
  return { rows, errors };
}

function listAccounts() {
  const rows = db
    .prepare(
      `
      SELECT email, client_id AS clientId, updated_at AS updatedAt
      FROM credentials
      ORDER BY email COLLATE NOCASE
      `,
    )
    .all();
  return rows.map((row) => ({
    id: accountId(row.email),
    email: row.email,
    clientId: row.clientId,
    updatedAt: row.updatedAt,
  }));
}

function findCredential(id) {
  const row = db
    .prepare("SELECT email, client_id AS clientId, refresh_token AS refreshToken FROM credentials")
    .all()
    .find((credential) => accountId(credential.email) === id);
  if (!row) throw new Error("未找到该账号。");
  return row;
}

function listCredentialsWithTokens() {
  return db
    .prepare("SELECT email, client_id AS clientId, refresh_token AS refreshToken FROM credentials ORDER BY email COLLATE NOCASE")
    .all();
}

function importRows(rows) {
  const statement = db.prepare(
    `
    INSERT INTO credentials (email, client_id, refresh_token, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(email) DO UPDATE SET
      client_id = excluded.client_id,
      refresh_token = excluded.refresh_token,
      updated_at = CURRENT_TIMESTAMP
    `,
  );
  let count = 0;
  for (const row of rows) {
    statement.run(row.email, row.clientId, row.refreshToken);
    count += 1;
  }
  return count;
}

function saveRotatedRefreshToken(email, refreshToken) {
  if (!refreshToken) return;
  db.prepare(
    `
    UPDATE credentials
    SET refresh_token = ?, updated_at = CURRENT_TIMESTAMP
    WHERE email = ?
    `,
  ).run(refreshToken, email);
}

async function refreshAccessToken(clientId, refreshToken) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await refreshAccessTokenOnce(clientId, refreshToken, attempt);
    } catch (error) {
      lastError = error;
      if (attempt === 2 || !isRetryableNetworkError(error)) break;
      await delay(800);
    }
  }
  throw lastError;
}

async function refreshAccessTokenOnce(clientId, refreshToken, attempt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: TOKEN_SCOPE,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`刷新 access_token 超时（${TOKEN_TIMEOUT_MS / 1000} 秒，第 ${attempt} 次）。`);
    }
    const cause = error.cause?.code || error.cause?.message || error.code || error.message;
    throw new Error(`Microsoft token 网络请求失败（第 ${attempt} 次）：${cause}`);
  } finally {
    clearTimeout(timer);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const description = body.error_description || body.error || `Microsoft token endpoint ${response.status}`;
    if (description.includes("AADSTS65001")) {
      throw new Error(
        `${description}\n\n该 refresh token 尚未被授予当前请求的 IMAP 权限。请在 Microsoft/Entra 侧预先同意应用的 IMAP.AccessAsUser.All 权限，或导入已经包含该权限的 refresh_token。`,
      );
    }
    if (body.error === "invalid_grant" || description.includes("AADSTS70000")) {
      throw new Error(
        `${description}\n\n该 refresh token 可能已经过期、被撤销或被新 token 替换。请重新导入该账号最新的 refresh_token。`,
      );
    }
    throw new Error(description);
  }
  if (!body.access_token) throw new Error("Token 接口未返回 access_token。");
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || "",
  };
}

function isRetryableNetworkError(error) {
  return /网络请求失败|超时|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(error.message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeMimeHeader(value = "") {
  return value.replace(/=\?([^?]+)\?([bqBQ])\?([^?]+)\?=/g, (_match, charset, mode, encoded) => {
    try {
      const buffer =
        mode.toLowerCase() === "b"
          ? Buffer.from(encoded, "base64")
          : decodeQuotedPrintableBuffer(encoded.replaceAll("_", " "));
      return buffer.toString(charset.toLowerCase() === "utf-8" ? "utf8" : "latin1");
    } catch {
      return encoded;
    }
  });
}

function unfoldHeaders(raw) {
  return String(raw || "").replace(/\r?\n[ \t]+/g, " ");
}

function parseHeaders(rawMessage) {
  const [headerText = ""] = String(rawMessage || "").split(/\r?\n\r?\n/, 1);
  const headers = new Map();
  for (const line of unfoldHeaders(headerText).split(/\r?\n/)) {
    const divider = line.indexOf(":");
    if (divider > 0) {
      headers.set(line.slice(0, divider).toLowerCase(), line.slice(divider + 1).trim());
    }
  }
  return headers;
}

function splitHeaderBody(rawMessage) {
  const message = String(rawMessage || "");
  const match = message.match(/\r?\n\r?\n/);
  if (!match || typeof match.index !== "number") return { headerText: message, body: "" };
  return {
    headerText: message.slice(0, match.index),
    body: message.slice(match.index + match[0].length),
  };
}

function parseContentType(value = "") {
  const [type = "text/plain", ...params] = String(value || "text/plain").split(";");
  const parsed = {
    type: type.trim().toLowerCase(),
    params: new Map(),
  };
  for (const param of params) {
    const divider = param.indexOf("=");
    if (divider < 0) continue;
    const key = param.slice(0, divider).trim().toLowerCase();
    const rawValue = param.slice(divider + 1).trim().replace(/^"|"$/g, "");
    parsed.params.set(key, rawValue);
  }
  return parsed;
}

function decodeQuotedPrintableBuffer(value) {
  const clean = String(value || "").replace(/=\r?\n/g, "");
  const bytes = [];
  for (let index = 0; index < clean.length; index += 1) {
    if (clean[index] === "=" && /^[0-9A-Fa-f]{2}$/.test(clean.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(clean.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(...Buffer.from(clean[index], "utf8"));
    }
  }
  return Buffer.from(bytes);
}

function decodeTransfer(body, headers) {
  const transfer = String(headers.get("content-transfer-encoding") || "").toLowerCase();
  const contentType = parseContentType(headers.get("content-type") || "");
  const charset = String(contentType.params.get("charset") || "utf-8").toLowerCase();
  let buffer;

  if (transfer === "base64") {
    buffer = Buffer.from(String(body || "").replace(/\s/g, ""), "base64");
  } else if (transfer === "quoted-printable") {
    buffer = decodeQuotedPrintableBuffer(body);
  } else {
    buffer = Buffer.from(String(body || ""), "utf8");
  }

  if (charset.includes("utf")) return buffer.toString("utf8");
  if (charset.includes("iso-8859-1") || charset.includes("latin")) return buffer.toString("latin1");
  return buffer.toString("utf8");
}

function splitMultipart(body, boundary) {
  const marker = `--${boundary}`;
  return String(body || "")
    .split(marker)
    .slice(1)
    .map((part) => part.replace(/^\r?\n/, "").replace(/\r?\n--\s*$/, ""))
    .filter((part) => part.trim() && !part.trim().startsWith("--"));
}

function extractReadableBody(rawMessage) {
  const headers = parseHeaders(rawMessage);
  const contentType = parseContentType(headers.get("content-type") || "text/plain");
  const { body } = splitHeaderBody(rawMessage);

  if (contentType.type.startsWith("multipart/")) {
    const boundary = contentType.params.get("boundary");
    if (!boundary) return "";
    const parts = splitMultipart(body, boundary).map((part) => {
      const partHeaders = parseHeaders(part);
      const partType = parseContentType(partHeaders.get("content-type") || "text/plain");
      return {
        type: partType.type,
        text: extractReadableBody(part),
      };
    });
    return (
      parts.find((part) => part.type === "text/plain" && part.text.trim())?.text ||
      parts.find((part) => part.type === "text/html" && part.text.trim())?.text ||
      parts.find((part) => part.text.trim())?.text ||
      ""
    );
  }

  const decoded = decodeTransfer(body, headers);
  if (contentType.type === "text/html") return htmlToText(decoded);
  return normalizeMailText(decoded);
}

function extractLinks(rawMessage) {
  const headers = parseHeaders(rawMessage);
  const contentType = parseContentType(headers.get("content-type") || "text/plain");
  const { body } = splitHeaderBody(rawMessage);

  if (contentType.type.startsWith("multipart/")) {
    const boundary = contentType.params.get("boundary");
    if (!boundary) return [];
    return uniqueLinks(splitMultipart(body, boundary).flatMap((part) => extractLinks(part)));
  }

  const decoded = decodeTransfer(body, headers);
  if (contentType.type === "text/html") return linksFromHtml(decoded);
  return linksFromText(decoded);
}

function linksFromHtml(html) {
  const links = [];
  for (const match of String(html || "").matchAll(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeHtmlEntities(match[2].trim());
    if (!isSafeLink(href)) continue;
    const label = normalizeMailText(htmlToText(match[3])).slice(0, 120) || href;
    links.push({ href, label });
  }
  return rankLinks([...links, ...linksFromText(htmlToText(html))]);
}

function linksFromText(text) {
  const links = [];
  for (const match of String(text || "").matchAll(/\bhttps?:\/\/[^\s<>"')]+/gi)) {
    const href = match[0].replace(/[.,;:!?]+$/g, "");
    if (isSafeLink(href)) links.push({ href, label: href });
  }
  return rankLinks(links);
}

function uniqueLinks(links) {
  const seen = new Set();
  const result = [];
  for (const link of links) {
    const normalized = normalizeLink(link.href);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push({ ...link, href: normalized });
  }
  return result;
}

function rankLinks(links) {
  return uniqueLinks(links)
    .map((link) => ({ ...link, score: linkScore(link) }))
    .filter((link) => link.score >= 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 6)
    .map(({ score: _score, ...link }) => link);
}

function normalizeLink(href) {
  try {
    const url = new URL(String(href || ""));
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref_|tag$|ascsubtag$|pf_rd_|pd_rd_|qid$|sr$|sprefix$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return "";
  }
}

function linkScore(link) {
  const href = String(link.href || "");
  const label = normalizeMailText(link.label || "");
  const combined = `${label} ${href}`.toLowerCase();
  let score = 10;

  if (/\b(sign in|log in|login|verify|confirm|continue|finish|access|magic|reset|code|activate|approve)\b/i.test(combined)) {
    score += 80;
  }
  if (label && label !== href && label.length <= 80) score += 15;
  if (/amazon\.com/i.test(href) && /\b(nav_|node=|b\?|gp\/|fashion|home-garden|fmc|deal|new-arrivals)\b/i.test(href)) {
    score -= 45;
  }
  if (/^(www\.)?amazon\.com$/i.test(safeHost(href)) && !/\b(sign|verify|confirm|account|ap\/|gp\/css|your-account)\b/i.test(combined)) {
    score -= 35;
  }
  if (!label || label === href || /^https?:\/\//i.test(label)) score -= 10;
  if (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(href)) score -= 100;
  if (/unsubscribe|privacy|terms|preferences|view in browser|manage email/i.test(combined)) score -= 20;

  return score;
}

function safeHost(href) {
  try {
    return new URL(href).host;
  } catch {
    return "";
  }
}

function isSafeLink(href) {
  return /^https?:\/\//i.test(href);
}

function assertSafeHttpUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url || ""));
  } catch {
    throw new Error("链接不是有效 URL。");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("只允许打开 http/https 链接。");
  }
  return parsed.toString();
}

function openPrivateWindow(url) {
  const safeUrl = assertSafeHttpUrl(url);
  const candidates =
    process.platform === "darwin"
      ? [
          { command: "open", args: ["-na", "Google Chrome", "--args", "--incognito", safeUrl] },
          { command: "open", args: ["-na", "Microsoft Edge", "--args", "--inprivate", safeUrl] },
          { command: "open", args: ["-na", "Brave Browser", "--args", "--incognito", safeUrl] },
          { command: "open", args: ["-na", "Firefox", "--args", "-private-window", safeUrl] },
        ]
      : process.platform === "win32"
        ? [
            { command: "cmd", args: ["/c", "start", "", "chrome", "--incognito", safeUrl] },
            { command: "cmd", args: ["/c", "start", "", "msedge", "--inprivate", safeUrl] },
            { command: "cmd", args: ["/c", "start", "", "firefox", "-private-window", safeUrl] },
          ]
        : [
            { command: "google-chrome", args: ["--incognito", safeUrl] },
            { command: "chromium", args: ["--incognito", safeUrl] },
            { command: "microsoft-edge", args: ["--inprivate", safeUrl] },
            { command: "firefox", args: ["-private-window", safeUrl] },
          ];

  return spawnFirst(candidates);
}

function spawnFirst(candidates) {
  return new Promise((resolve, reject) => {
    let index = 0;
    const errors = [];

    function next() {
      const candidate = candidates[index];
      index += 1;
      if (!candidate) {
        reject(new Error(`未找到可用浏览器打开无痕窗口：${errors.join("; ")}`));
        return;
      }

      const child = spawn(candidate.command, candidate.args, {
        detached: true,
        stdio: "ignore",
      });
      let failed = false;
      child.once("error", (error) => {
        failed = true;
        errors.push(`${candidate.command}: ${error.message}`);
        next();
      });
      child.once("spawn", () => {
        if (!failed) {
          child.unref();
          resolve({ command: candidate.command });
        }
      });
    }

    next();
  });
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16)));
}

function htmlToText(html) {
  return normalizeMailText(
    String(html || "")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<(br|hr)\b[^>]*>/gi, "\n")
      .replace(/<\/(p|div|tr|table|h[1-6]|li)>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16))),
  );
}

function normalizeMailText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function summarizeMessage(fetched) {
  const rawMessage = typeof fetched === "string" ? fetched : fetched.raw;
  const headers = parseHeaders(rawMessage);
  return {
    uid: typeof fetched === "string" ? "" : fetched.uid,
    receivedAt: typeof fetched === "string" ? "" : fetched.internalDate,
    from: decodeMimeHeader(headers.get("from") || ""),
    date: headers.get("date") || "",
    subject: decodeMimeHeader(headers.get("subject") || "(无主题)"),
    body: extractReadableBody(rawMessage).slice(0, 20000),
    links: extractLinks(rawMessage),
  };
}

class ImapClient {
  constructor(host, port) {
    this.host = host;
    this.port = port;
    this.socket = null;
    this.buffer = "";
    this.pending = [];
    this.tag = 0;
    this.closed = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error(`等待 IMAP 服务器问候超时（${IMAP_CONNECT_TIMEOUT_MS / 1000} 秒）。`));
        this.socket?.destroy();
      }, IMAP_CONNECT_TIMEOUT_MS);
      this.socket = tlsConnect(this.port, this.host, { servername: this.host }, () => {});
      this.socket.setEncoding("utf8");
      this.socket.on("data", (chunk) => {
        this.buffer += chunk;
        this.flushPending();
      });
      this.socket.on("error", (error) => this.fail(error));
      this.socket.on("close", () => {
        if (!this.closed) this.fail(new Error("IMAP 连接已关闭。"));
      });
      this.pending.push({
        tag: "*",
        resolve: (text) => {
          clearTimeout(timer);
          resolve(text);
        },
        reject,
      });
    });
  }

  flushPending() {
    if (!this.pending.length) return;
    const current = this.pending[0];
    if (current.mode === "line") {
      const lineEnd = this.buffer.indexOf("\r\n");
      if (lineEnd >= 0) {
        const text = this.buffer.slice(0, lineEnd + 2);
        this.buffer = this.buffer.slice(lineEnd + 2);
        this.pending.shift();
        clearTimeout(current.timer);
        current.resolve(text);
      }
      return;
    }
    if (current.tag === "*") {
      const lineEnd = this.buffer.indexOf("\r\n");
      if (lineEnd >= 0) {
        const text = this.buffer.slice(0, lineEnd + 2);
        this.buffer = this.buffer.slice(lineEnd + 2);
        this.pending.shift();
        clearTimeout(current.timer);
        current.resolve(text);
      }
      return;
    }
    const endMarker = `\r\n${current.tag} `;
    const endIndex = this.buffer.indexOf(endMarker);
    if (endIndex >= 0) {
      const statusEnd = this.buffer.indexOf("\r\n", endIndex + 2);
      if (statusEnd >= 0) {
        const text = this.buffer.slice(0, statusEnd + 2);
        this.buffer = this.buffer.slice(statusEnd + 2);
        this.pending.shift();
        clearTimeout(current.timer);
        current.resolve(text);
      }
    }
  }

  fail(error) {
    while (this.pending.length) {
      const current = this.pending.shift();
      clearTimeout(current.timer);
      current.reject(error);
    }
  }

  command(command) {
    const tag = `A${String(++this.tag).padStart(4, "0")}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = this.pending.filter((item) => item.tag !== tag);
        reject(new Error(`IMAP 命令超时：${command.split(" ")[0]}（${IMAP_COMMAND_TIMEOUT_MS / 1000} 秒）。`));
        this.socket?.destroy();
      }, IMAP_COMMAND_TIMEOUT_MS);
      this.pending.push({ tag, resolve, reject, timer });
      this.write(`${tag} ${command}\r\n`);
      this.flushPending();
    });
  }

  readLine(label) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = this.pending.filter((item) => item.timer !== timer);
        reject(new Error(`IMAP 命令超时：${label}（${IMAP_COMMAND_TIMEOUT_MS / 1000} 秒）。`));
        this.socket?.destroy();
      }, IMAP_COMMAND_TIMEOUT_MS);
      this.pending.push({ mode: "line", resolve, reject, timer });
      this.flushPending();
    });
  }

  write(text) {
    this.socket.write(text);
  }

  async authenticate(email, accessToken) {
    const xoauth2 = Buffer.from(`user=${email}\x01auth=Bearer ${accessToken}\x01\x01`).toString("base64");
    const tag = `A${String(++this.tag).padStart(4, "0")}`;
    let challenge = "";
    let sentToken = false;
    this.write(`${tag} AUTHENTICATE XOAUTH2\r\n`);

    while (true) {
      const line = await this.readLine("AUTHENTICATE").then((text) => text.trimEnd());
      if (line.startsWith("+")) {
        const payload = line.slice(1).trim();
        if (payload) {
          challenge = decodeBase64Challenge(payload);
          this.write("\r\n");
        } else if (!sentToken) {
          sentToken = true;
          this.write(`${xoauth2}\r\n`);
        } else {
          this.write("\r\n");
        }
        continue;
      }
      if (line.startsWith(`${tag} `)) {
        if (new RegExp(`^${tag} OK`, "i").test(line)) return;
        throw new Error(
          `IMAP XOAUTH2 登录失败：${line}${challenge ? `\n${challenge}` : ""}`,
        );
      }
    }
  }

  async selectMailbox(mailbox = "INBOX") {
    const response = await this.command(`SELECT ${quoteMailbox(mailbox)}`);
    if (!/\r\nA\d+ OK/i.test(response)) throw new Error(`无法选择文件夹 ${mailbox}：${lastLine(response)}`);
    this.readOnly = /\[READ-ONLY\]/i.test(response);
  }

  async listMailboxes() {
    const response = await this.command('LIST "" "*"');
    if (!/\r\nA\d+ OK/i.test(response)) throw new Error(`无法列出文件夹：${lastLine(response)}`);
    return parseListResponse(response);
  }

  async latestUids(count = 3) {
    const response = await this.command("UID SEARCH ALL");
    const match = response.match(/\* SEARCH ([^\r\n]*)/i);
    const ids = match?.[1]?.trim() ? match[1].trim().split(/\s+/) : [];
    const candidates = ids
      .map((id) => Number(id))
      .filter(Number.isFinite)
      .sort((left, right) => right - left)
      .slice(0, 100)
      .map(String);

    const dated = await this.fetchUidDates(candidates);
    if (!dated.length) return candidates.slice(0, count);
    return dated
      .sort((left, right) => {
        const dateDiff = right.timestamp - left.timestamp;
        return dateDiff || Number(right.uid) - Number(left.uid);
      })
      .slice(0, count)
      .map((item) => item.uid);
  }

  async unreadCount() {
    const response = await this.command("UID SEARCH UNSEEN");
    const match = response.match(/\* SEARCH ([^\r\n]*)/i);
    if (!match?.[1]?.trim()) return 0;
    return match[1].trim().split(/\s+/).filter(Boolean).length;
  }

  async fetchUidDates(uids) {
    if (!uids.length) return [];
    const response = await this.command(`UID FETCH ${uids.join(",")} (UID INTERNALDATE)`);
    if (!/\r\nA\d+ OK/i.test(response)) return [];
    return [...response.matchAll(/\* \d+ FETCH \((?=[^)]*\bUID (\d+))(?=[^)]*\bINTERNALDATE "([^"]+)")/gi)]
      .map((match) => ({
        uid: match[1],
        timestamp: Date.parse(match[2]),
      }))
      .filter((item) => Number.isFinite(item.timestamp));
  }

  async fetchMessage(uid) {
    const response = await this.command(`UID FETCH ${uid} (UID INTERNALDATE BODY.PEEK[])`);
    if (!/\r\nA\d+ OK/i.test(response)) throw new Error(`抓取邮件失败：${lastLine(response)}`);
    const internalDate = response.match(/INTERNALDATE "([^"]+)"/i)?.[1] || "";
    const raw = extractImapLiteral(response);
    return {
      uid,
      internalDate,
      raw,
    };
  }

  async markSeen(uids) {
    const ids = sanitizeUids(uids);
    if (!ids.length) return 0;
    if (this.readOnly) {
      throw new Error("当前文件夹以只读模式打开，不能标为已读。");
    }
    let response = await this.command(`UID STORE ${ids.join(",")} +FLAGS.SILENT (\\Seen)`);
    if (!/\r\nA\d+ OK/i.test(response)) {
      response = await this.command(`UID STORE ${ids.join(",")} +FLAGS (\\Seen)`);
    }
    if (!/\r\nA\d+ OK/i.test(response)) {
      throw new Error(`IMAP STORE 失败：${lastLine(response)}`);
    }
    return ids.length;
  }

  async logout() {
    try {
      await this.command("LOGOUT");
    } catch {
      // Ignore logout failures; the socket is closed below.
    }
    this.closed = true;
    this.socket?.end();
  }

  destroy() {
    this.closed = true;
    this.fail(new Error("IMAP 请求已取消。"));
    this.socket?.destroy();
  }
}

function lastLine(response) {
  return response.trim().split(/\r?\n/).at(-1) || response.trim();
}

function extractImapLiteral(response) {
  const match = response.match(/\{(\d+)\}\r\n/);
  if (!match || typeof match.index !== "number") return response;
  const byteLength = Number(match[1]);
  const start = match.index + match[0].length;
  if (!Number.isFinite(byteLength) || byteLength < 0) return response.slice(start);

  let bytes = 0;
  let end = start;
  while (end < response.length && bytes < byteLength) {
    const code = response.charCodeAt(end);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      end += 1;
    } else {
      bytes += 3;
    }
    end += 1;
  }
  return response.slice(start, end);
}

function decodeBase64Challenge(value) {
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    try {
      const parsed = JSON.parse(decoded);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return decoded;
    }
  } catch {
    return value;
  }
}

function quoteMailbox(mailbox) {
  return `"${String(mailbox).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function sanitizeUids(uids) {
  return [...new Set((Array.isArray(uids) ? uids : [])
    .map((uid) => String(uid || "").trim())
    .filter((uid) => /^\d+$/.test(uid)))];
}

function parseListResponse(response) {
  const folders = [];
  for (const line of response.split(/\r?\n/)) {
    if (!line.startsWith("* LIST ")) continue;
    const name = parseListMailboxName(line);
    if (!name) continue;
    folders.push({
      name,
      label: folderLabel(name),
    });
  }
  return prioritizeFolders(folders);
}

function parseListMailboxName(line) {
  const match = line.match(/^\* LIST \([^)]*\) (?:"(?:\\"|[^"])*"|NIL) (.+)$/i);
  if (!match) return "";
  const rawName = match[1].trim();
  let name = rawName;

  if (rawName.startsWith('"')) {
    const quoted = rawName.match(/^"((?:\\"|[^"])*)"/);
    name = quoted?.[1]?.replace(/\\"/g, '"').replace(/\\\\/g, "\\") || "";
  } else {
    name = rawName.split(/\s+/)[0] || "";
  }

  return decodeModifiedUtf7(name);
}

function decodeModifiedUtf7(value) {
  return value.replace(/&([^-]*)-/g, (_match, encoded) => {
    if (!encoded) return "&";
    try {
      const base64 = encoded.replaceAll(",", "/");
      const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
      const buffer = Buffer.from(padded, "base64");
      const chars = [];
      for (let index = 0; index < buffer.length; index += 2) {
        chars.push(String.fromCharCode(buffer.readUInt16BE(index)));
      }
      return chars.join("");
    } catch {
      return encoded;
    }
  });
}

function folderLabel(name) {
  const lower = name.toLowerCase();
  if (lower === "inbox") return "Inbox / 收件箱";
  if (lower.includes("junk")) return `${name} / 垃圾邮件`;
  if (lower.includes("deleted")) return `${name} / 已删除`;
  if (lower.includes("sent")) return `${name} / 已发送`;
  if (lower.includes("draft")) return `${name} / 草稿`;
  if (lower.includes("archive")) return `${name} / 归档`;
  return name;
}

function prioritizeFolders(folders) {
  const score = (folder) => {
    const lower = folder.name.toLowerCase();
    if (lower === "inbox") return 0;
    if (lower.includes("junk")) return 1;
    if (lower.includes("other")) return 2;
    if (lower.includes("focused")) return 3;
    if (lower.includes("archive")) return 4;
    if (lower.includes("deleted")) return 5;
    return 10;
  };
  return [...folders].sort((left, right) => {
    const diff = score(left) - score(right);
    return diff || left.name.localeCompare(right.name);
  });
}

async function withAuthenticatedClient(clientId, refreshToken, email, callback) {
  const client = new ImapClient(IMAP_HOST, IMAP_PORT);
  return withTimeout(
    (async () => {
      try {
        const token = await refreshAccessToken(clientId, refreshToken);
        if (token.refreshToken && token.refreshToken !== refreshToken) {
          saveRotatedRefreshToken(email, token.refreshToken);
        }
        await client.connect();
        await client.authenticate(email, token.accessToken);
        return await callback(client);
      } finally {
        await client.logout();
      }
    })(),
    FETCH_TIMEOUT_MS,
    `读取邮箱总超时（${FETCH_TIMEOUT_MS / 1000} 秒）。`,
    () => client.destroy(),
  );
}

async function listFolders(clientId, refreshToken, email) {
  return withAuthenticatedClient(clientId, refreshToken, email, (client) => client.listMailboxes());
}

async function refreshAndFetch(clientId, refreshToken, email, folder = "INBOX") {
  return withAuthenticatedClient(clientId, refreshToken, email, async (client) => {
    await client.selectMailbox(folder);
    const unreadCount = await client.unreadCount();
    const ids = await client.latestUids(3);
    const messages = [];
    for (const id of ids) {
      try {
        messages.push(summarizeMessage(await client.fetchMessage(id)));
      } catch (error) {
        messages.push({
          uid: id,
          receivedAt: "",
          from: "Error",
          date: nowIso(),
          subject: "邮件解析失败",
          body: error.message,
          links: [],
        });
      }
    }
    return { unreadCount, messages };
  });
}

async function markMessagesRead(clientId, refreshToken, email, folder = "INBOX", uids = []) {
  return withAuthenticatedClient(clientId, refreshToken, email, async (client) => {
    await client.selectMailbox(folder);
    const markedCount = await client.markSeen(uids);
    const unreadCount = await client.unreadCount();
    return { markedCount, unreadCount };
  });
}

function withTimeout(promise, timeoutMs, message, onTimeout = () => {}) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error(message));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const tokenKeepaliveState = {
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastSummary: null,
  lastErrors: [],
};

async function refreshStoredTokens(reason = "scheduled") {
  if (tokenKeepaliveState.running) {
    return {
      skipped: true,
      reason: "token keepalive already running",
      ...tokenKeepaliveState.lastSummary,
    };
  }

  tokenKeepaliveState.running = true;
  tokenKeepaliveState.lastStartedAt = nowIso();
  const credentials = listCredentialsWithTokens();
  const summary = {
    reason,
    total: credentials.length,
    refreshed: 0,
    rotated: 0,
    failed: 0,
  };
  const errors = [];

  for (const credential of credentials) {
    try {
      const token = await refreshAccessToken(credential.clientId, credential.refreshToken);
      summary.refreshed += 1;
      if (token.refreshToken && token.refreshToken !== credential.refreshToken) {
        saveRotatedRefreshToken(credential.email, token.refreshToken);
        summary.rotated += 1;
      }
    } catch (error) {
      summary.failed += 1;
      errors.push({
        email: credential.email,
        error: error.message,
      });
    }
    await delay(250);
  }

  tokenKeepaliveState.running = false;
  tokenKeepaliveState.lastFinishedAt = nowIso();
  tokenKeepaliveState.lastSummary = summary;
  tokenKeepaliveState.lastErrors = errors.slice(-20);
  console.log(
    `Token keepalive ${reason}: ${summary.refreshed}/${summary.total} refreshed, ${summary.rotated} rotated, ${summary.failed} failed`,
  );
  return summary;
}

function startTokenKeepalive() {
  if (!TOKEN_KEEPALIVE_INTERVAL_MS || TOKEN_KEEPALIVE_INTERVAL_MS < 60_000) return;
  setTimeout(() => {
    refreshStoredTokens("startup").catch((error) => {
      tokenKeepaliveState.running = false;
      tokenKeepaliveState.lastErrors = [{ email: "*", error: error.message }];
      console.error(`Token keepalive startup failed: ${error.message}`);
    });
  }, TOKEN_KEEPALIVE_START_DELAY_MS).unref();

  setInterval(() => {
    refreshStoredTokens("scheduled").catch((error) => {
      tokenKeepaliveState.running = false;
      tokenKeepaliveState.lastErrors = [{ email: "*", error: error.message }];
      console.error(`Token keepalive scheduled failed: ${error.message}`);
    });
  }, TOKEN_KEEPALIVE_INTERVAL_MS).unref();
}

async function routeApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/accounts") {
    jsonResponse(res, 200, { accounts: listAccounts() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/token-keepalive/status") {
    jsonResponse(res, 200, tokenKeepaliveState);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/token-keepalive/run") {
    jsonResponse(res, 200, await refreshStoredTokens("manual"));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import") {
    const body = await getBody(req);
    const parsed = parseCredentialText(body.credentials || body.csv);
    const imported = importRows(parsed.rows);
    jsonResponse(res, 200, {
      imported,
      errors: parsed.errors,
      accounts: listAccounts(),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/open-private") {
    const body = await getBody(req);
    const result = await openPrivateWindow(body.url);
    jsonResponse(res, 200, { ok: true, command: result.command });
    return;
  }

  if (req.method === "POST" && url.pathname.match(/^\/api\/accounts\/[^/]+\/fetch$/)) {
    const id = url.pathname.split("/")[3];
    const body = await getBody(req);
    const credential = findCredential(id);
    const snapshot = await refreshAndFetch(
      credential.clientId,
      credential.refreshToken,
      credential.email,
      body.folder || "INBOX",
    );
    jsonResponse(res, 200, {
      account: {
        id: accountId(credential.email),
        email: credential.email,
        clientId: credential.clientId,
        folder: body.folder || "INBOX",
        fetchedAt: nowIso(),
        unreadCount: snapshot.unreadCount,
      },
      unreadCount: snapshot.unreadCount,
      messages: snapshot.messages,
    });
    return;
  }

  if (req.method === "POST" && url.pathname.match(/^\/api\/accounts\/[^/]+\/mark-read$/)) {
    const id = url.pathname.split("/")[3];
    const body = await getBody(req);
    const credential = findCredential(id);
    const result = await markMessagesRead(
      credential.clientId,
      credential.refreshToken,
      credential.email,
      body.folder || "INBOX",
      body.uids || [],
    );
    jsonResponse(res, 200, {
      account: {
        id: accountId(credential.email),
        email: credential.email,
        folder: body.folder || "INBOX",
        fetchedAt: nowIso(),
        unreadCount: result.unreadCount,
      },
      markedCount: result.markedCount,
      unreadCount: result.unreadCount,
    });
    return;
  }

  if (req.method === "GET" && url.pathname.match(/^\/api\/accounts\/[^/]+\/folders$/)) {
    const id = url.pathname.split("/")[3];
    const credential = findCredential(id);
    const folders = await listFolders(
      credential.clientId,
      credential.refreshToken,
      credential.email,
    );
    jsonResponse(res, 200, { folders });
    return;
  }

  jsonResponse(res, 404, { error: "接口不存在。" });
}

async function serveStatic(_req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = normalize(join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const content = await readFile(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(content);
  } catch {
    const fallback = await readFile(join(PUBLIC_DIR, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(fallback);
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `localhost:${PORT}`}`);
    if (url.pathname.startsWith("/api/")) {
      await routeApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    console.error(error.stack || error.message || error);
    jsonResponse(res, 500, { error: error.message || "服务器内部错误。" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Internal OAuth2 IMAP viewer is running at http://${HOST}:${PORT}`);
  console.log(`SQLite database: ${DB_FILE}`);
  console.log(`Token keepalive interval: ${Math.round(TOKEN_KEEPALIVE_INTERVAL_MS / 60000)} minutes`);
  startTokenKeepalive();
});
