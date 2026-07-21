# 失活邮箱顶部操作入口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在顶部账号操作栏提供清晰可见的“检测失活”和“删除失活（N）”入口。

**Architecture:** 复用 `public/app.js` 中已有的 `runTokenKeepalive()`、`inactiveAccountIdList()` 和 `deleteInactiveAccounts()`，不新增后端接口。顶部入口与左侧批量栏共享相同状态和事件处理函数，确保安全判定、禁用条件和确认流程一致。

**Tech Stack:** 浏览器原生 ES Modules、HTML 模板字符串、Node.js 内置测试运行器。

## Global Constraints

- 仅凭证明确失效、账号禁用或账号不存在被判定为失活。
- 网络超时、限流、IMAP 错误和权限不足不进入删除名单。
- 删除前必须重新计算名单并进行二次确认。
- 不改动或回退工作区内其他现有修改。

---

### Task 1: 顶部操作入口

**Files:**
- Modify: `public/app.js:484-505`
- Test: `test/account-health.test.js`

**Interfaces:**
- Consumes: `inactiveAccountIdList(): string[]`、`tokenDetectionRunning(): boolean`、`accountSelectionBusy(): boolean`
- Produces: DOM 按钮 `#detect-inactive-accounts-top` 与 `#delete-inactive-accounts-top`

- [ ] **Step 1: 扩展现有健康判定测试**

确认 `inactiveAccountIds()` 在 `checking: true` 时返回空数组，并且只返回终止性失败；现有 `test/account-health.test.js` 已覆盖这两项，先运行作为基线：

```bash
node --test test/account-health.test.js
```

Expected: 4 tests pass, 0 fail.

- [ ] **Step 2: 在顶部操作栏渲染入口**

在 `renderActionsPanel()` 中计算 `inactiveCount` 和 `busy`，并在现有账号操作按钮附近加入：

```js
<button id="detect-inactive-accounts-top" ${!state.accounts.length || busy ? "disabled" : ""}>
  ${tokenDetectionRunning() ? "检测中" : "检测失活"}
</button>
<button id="delete-inactive-accounts-top" class="danger" ${!inactiveCount || busy ? "disabled" : ""}>
  删除失活${inactiveCount ? ` (${inactiveCount})` : ""}
</button>
```

- [ ] **Step 3: 绑定顶部入口**

在 `bindEvents()` 中复用已有函数：

```js
document.querySelector("#detect-inactive-accounts-top")?.addEventListener("click", runTokenKeepalive);
document.querySelector("#delete-inactive-accounts-top")?.addEventListener("click", deleteInactiveAccounts);
```

- [ ] **Step 4: 运行静态验证**

```bash
npm run check
git diff --check
```

Expected: both commands exit 0.

- [ ] **Step 5: 运行完整测试**

```bash
node --test
```

Expected: 10 tests pass, 0 fail.

- [ ] **Step 6: 核对顶部入口**

检查 `public/app.js`，确认两个顶部按钮分别绑定 `runTokenKeepalive` 和 `deleteInactiveAccounts`，且删除按钮在 `inactiveCount === 0` 或任何账号操作繁忙时禁用。
