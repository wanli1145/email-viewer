export function accountKey(email) {
  return String(email || "").trim().toLowerCase();
}

function evidenceTime(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function failureIsTerminal(result) {
  return Boolean(result?.inactive || result?.failure?.terminal);
}

function classifyRefresh(refresh) {
  if (refresh?.status === "ok") return "alive";
  if (refresh?.status === "error") return failureIsTerminal(refresh) ? "inactive" : "error";
  if (refresh?.status === "running" || refresh?.status === "queued") return "checking";
  return "pending";
}

function classifyToken(token) {
  if (token?.ok === true) return "alive";
  if (token?.ok === false) return failureIsTerminal(token) ? "inactive" : "error";
  return "pending";
}

export function classifyAccountHealth({ refresh = {}, token = null, checking = false } = {}) {
  if (checking || refresh.status === "running" || refresh.status === "queued") return "checking";

  const refreshKind = classifyRefresh(refresh);
  const tokenKind = classifyToken(token);
  const refreshHasEvidence = refreshKind === "alive" || refreshKind === "error" || refreshKind === "inactive";
  const tokenHasEvidence = tokenKind === "alive" || tokenKind === "error" || tokenKind === "inactive";

  if (refreshHasEvidence && tokenHasEvidence) {
    const refreshCheckedAt = evidenceTime(refresh.fetchedAt || refresh.checkedAt);
    const tokenCheckedAt = evidenceTime(token?.checkedAt);
    if (refreshCheckedAt && tokenCheckedAt) {
      return tokenCheckedAt > refreshCheckedAt ? tokenKind : refreshKind;
    }
  }

  if (refreshKind === "inactive" || refreshKind === "error") return refreshKind;
  if (tokenKind === "inactive" || tokenKind === "error") {
    return refreshKind === "alive" ? "alive" : tokenKind;
  }
  if (refreshKind === "alive" || tokenKind === "alive") return "alive";
  return "pending";
}

export function inactiveAccountIds(
  accounts,
  refreshByAccount = {},
  tokenResults = [],
  { checking = false } = {},
) {
  if (checking) return [];
  const tokenByEmail = new Map((tokenResults || []).map((result) => [accountKey(result.email), result]));
  return (accounts || [])
    .filter((account) =>
      classifyAccountHealth({
        refresh: refreshByAccount[account.id] || {},
        token: tokenByEmail.get(accountKey(account.email)) || null,
      }) === "inactive",
    )
    .map((account) => account.id);
}
