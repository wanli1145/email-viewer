import assert from "node:assert/strict";
import test from "node:test";

import { classifyAccountHealth, inactiveAccountIds } from "../public/account-health.js";

const terminalFailure = {
  terminal: true,
  kind: "credential_invalid",
};

test("classifies only terminal failures as inactive", () => {
  assert.equal(
    classifyAccountHealth({ refresh: { status: "error", failure: terminalFailure } }),
    "inactive",
  );
  assert.equal(
    classifyAccountHealth({ refresh: { status: "error", failure: { terminal: false, kind: "temporary" } } }),
    "error",
  );
  assert.equal(
    classifyAccountHealth({ token: { ok: false, failure: terminalFailure } }),
    "inactive",
  );
});

test("does not classify checking, healthy, pending, permission, or network failures as inactive", () => {
  assert.equal(classifyAccountHealth({ checking: true, token: { ok: false, failure: terminalFailure } }), "checking");
  assert.equal(classifyAccountHealth({ refresh: { status: "ok" } }), "alive");
  assert.equal(classifyAccountHealth({ token: { ok: true } }), "alive");
  assert.equal(classifyAccountHealth({}), "pending");
  assert.equal(
    classifyAccountHealth({ token: { ok: false, failure: { terminal: false, kind: "permission_required" } } }),
    "error",
  );
  assert.equal(
    classifyAccountHealth({ token: { ok: false, failure: { terminal: false, kind: "temporary" } } }),
    "error",
  );
});

test("uses the newest successful evidence over an older failure", () => {
  assert.equal(
    classifyAccountHealth({
      refresh: { status: "error", failure: terminalFailure, fetchedAt: "2026-07-14T10:00:00Z" },
      token: { ok: true, checkedAt: "2026-07-14T11:00:00Z" },
    }),
    "alive",
  );
  assert.equal(
    classifyAccountHealth({
      refresh: { status: "ok", fetchedAt: "2026-07-14T11:00:00Z" },
      token: { ok: false, failure: terminalFailure, checkedAt: "2026-07-14T10:00:00Z" },
    }),
    "alive",
  );
});

test("returns only inactive account IDs in account order", () => {
  const accounts = [
    { id: "a", email: "A@example.com" },
    { id: "b", email: " b@example.com " },
    { id: "c", email: "c@example.com" },
  ];
  const refreshByAccount = {
    a: { status: "error", failure: terminalFailure },
    c: { status: "error", failure: { terminal: false, kind: "temporary" } },
  };
  const tokenResults = [
    { email: "B@EXAMPLE.COM", ok: false, failure: terminalFailure },
  ];

  assert.deepEqual(inactiveAccountIds(accounts, refreshByAccount, tokenResults), ["a", "b"]);
  assert.deepEqual(inactiveAccountIds(accounts, refreshByAccount, tokenResults, { checking: true }), []);
  assert.deepEqual(inactiveAccountIds([], {}, []), []);
});
