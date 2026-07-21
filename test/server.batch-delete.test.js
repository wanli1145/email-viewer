import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startServer } from "../server.js";

const credentials = [
  {
    email: "alpha@example.com",
    clientId: "client-alpha",
    refreshToken: "refresh-alpha",
  },
  {
    email: "bravo@example.com",
    clientId: "client-bravo",
    refreshToken: "refresh-bravo",
  },
  {
    email: "charlie@example.com",
    clientId: "client-charlie",
    refreshToken: "refresh-charlie",
  },
];

async function requestJson(baseUrl, pathname, options = {}) {
  const hasBody = Object.hasOwn(options, "body");
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers: hasBody ? { "content-type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json();
  return { status: response.status, body };
}

async function withSeededServer(run) {
  const directory = await mkdtemp(join(tmpdir(), "outlook-batch-delete-"));
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dbFile: join(directory, "credentials.sqlite3"),
  });

  try {
    const credentialText = credentials
      .map(({ email, clientId, refreshToken }) => `${email}----${clientId}----${refreshToken}`)
      .join("\n");
    const imported = await requestJson(server.url, "/api/import", {
      method: "POST",
      body: { credentials: credentialText },
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.body.imported, credentials.length);
    assert.equal(imported.body.errors.length, 0);

    const listed = await requestJson(server.url, "/api/accounts");
    assert.equal(listed.status, 200);
    assert.equal(listed.body.accounts.length, credentials.length);
    const accountsByEmail = new Map(
      listed.body.accounts.map((account) => [account.email, account]),
    );

    await run({
      url: server.url,
      accountsByEmail,
    });
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("batch delete removes two accounts and returns the remaining account", async () => {
  await withSeededServer(async ({ url, accountsByEmail }) => {
    const ids = [
      accountsByEmail.get("alpha@example.com").id,
      accountsByEmail.get("bravo@example.com").id,
    ];
    const deleted = await requestJson(url, "/api/accounts/batch-delete", {
      method: "POST",
      body: { ids },
    });

    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.ok, true);
    assert.equal(deleted.body.deleted, 2);
    assert.deepEqual(
      deleted.body.accounts.map((account) => account.email),
      ["charlie@example.com"],
    );

    const listed = await requestJson(url, "/api/accounts");
    assert.deepEqual(
      listed.body.accounts.map((account) => account.email),
      ["charlie@example.com"],
    );
  });
});

test("batch delete counts a duplicate account ID only once", async () => {
  await withSeededServer(async ({ url, accountsByEmail }) => {
    const id = accountsByEmail.get("alpha@example.com").id;
    const deleted = await requestJson(url, "/api/accounts/batch-delete", {
      method: "POST",
      body: { ids: [id, id] },
    });

    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.deleted, 1);
    assert.deepEqual(
      deleted.body.accounts.map((account) => account.email),
      ["bravo@example.com", "charlie@example.com"],
    );
  });
});

test("batch delete removes website marks owned by the deleted account", async () => {
  await withSeededServer(async ({ url, accountsByEmail }) => {
    const account = accountsByEmail.get("alpha@example.com");
    const createdSite = await requestJson(url, "/api/sites", {
      method: "POST",
      body: { site: "example.test" },
    });
    const siteId = createdSite.body.sites[0].id;

    const marked = await requestJson(url, `/api/accounts/${account.id}/sites/${siteId}`, {
      method: "PUT",
      body: { marked: true },
    });
    assert.deepEqual(
      marked.body.accounts.find((item) => item.id === account.id).siteIds,
      [siteId],
    );

    const deleted = await requestJson(url, "/api/accounts/batch-delete", {
      method: "POST",
      body: { ids: [account.id] },
    });
    assert.equal(deleted.status, 200);

    const credential = credentials.find((item) => item.email === account.email);
    const reimported = await requestJson(url, "/api/import", {
      method: "POST",
      body: {
        credentials: `${credential.email}----${credential.clientId}----${credential.refreshToken}`,
      },
    });
    const restoredAccount = reimported.body.accounts.find((item) => item.email === account.email);
    assert.deepEqual(restoredAccount.siteIds, []);
  });
});

test("batch delete rejects empty and non-array IDs with 400", async () => {
  await withSeededServer(async ({ url, accountsByEmail }) => {
    const invalidBodies = [
      { label: "empty IDs", body: { ids: [] } },
      {
        label: "non-array IDs",
        body: { ids: accountsByEmail.get("alpha@example.com").id },
      },
    ];

    for (const invalid of invalidBodies) {
      const response = await requestJson(url, "/api/accounts/batch-delete", {
        method: "POST",
        body: invalid.body,
      });
      assert.equal(response.status, 400, invalid.label);
      assert.equal(typeof response.body.error, "string", invalid.label);
      assert.notEqual(response.body.error.trim(), "", invalid.label);
    }

    const listed = await requestJson(url, "/api/accounts");
    assert.equal(listed.body.accounts.length, credentials.length);
  });
});

test("batch delete is atomic when one account ID is unknown", async () => {
  await withSeededServer(async ({ url, accountsByEmail }) => {
    const existingId = accountsByEmail.get("alpha@example.com").id;
    const deleted = await requestJson(url, "/api/accounts/batch-delete", {
      method: "POST",
      body: { ids: [existingId, "unknown-account-id"] },
    });

    assert.equal(deleted.status, 404);
    assert.match(deleted.body.error, /未找到该账号/);

    const listed = await requestJson(url, "/api/accounts");
    assert.deepEqual(
      listed.body.accounts.map((account) => account.email),
      credentials.map((credential) => credential.email),
    );
  });
});

test("v1 batch-delete route deletes accounts and returns the v1 account shape", async () => {
  await withSeededServer(async ({ url, accountsByEmail }) => {
    const id = accountsByEmail.get("bravo@example.com").id;
    const deleted = await requestJson(url, "/api/v1/accounts/batch-delete", {
      method: "POST",
      body: { ids: [id] },
    });

    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.ok, true);
    assert.equal(deleted.body.deleted, 1);
    assert.deepEqual(
      deleted.body.accounts.map((account) => account.email),
      ["alpha@example.com", "charlie@example.com"],
    );
    assert.ok(
      deleted.body.accounts.every((account) => Object.hasOwn(account, "tokenKeepalive")),
    );

    const listed = await requestJson(url, "/api/v1/accounts");
    assert.deepEqual(
      listed.body.accounts.map((account) => account.email),
      ["alpha@example.com", "charlie@example.com"],
    );
  });
});
