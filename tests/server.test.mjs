import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createAppServer } from "../server.mjs";

process.env.AI_API_KEY = "";
process.env.GEMINI_API_KEY = "";

const dataDir = await mkdtemp(join(tmpdir(), "bot-nur-test-"));
const server = createAppServer({ dataDir });
let baseUrl;

before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await rm(dataDir, { recursive: true, force: true });
});

async function request(path, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    response,
    data: await response.json(),
    cookie: response.headers.getSetCookie()?.[0]?.split(";")[0],
  };
}

test("serves the interface and reports the API health status", async () => {
  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/);
  assert.match(await page.text(), /Uma boa ideia/);

  const publicHealth = await request("/health");
  assert.equal(publicHealth.data.status, "ok");
  assert.deepEqual(Object.keys(publicHealth.data), ["status"]);

  const previousGeminiKey = process.env.GEMINI_API_KEY;
  try {
    process.env.GEMINI_API_KEY = "health-test-key";
    const health = await request("/api/health");
    assert.equal(health.data.status, "ok");
    assert.equal(health.data.aiConfigured, true);
  } finally {
    if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGeminiKey;
  }
});

test("creates a visitor and retains conversations and messages in SQLite", async () => {
  const guest = await request("/api/auth/guest", { method: "POST", body: {} });
  assert.equal(guest.response.status, 201);
  assert.equal(guest.data.user.name, "Visitante");
  assert.ok(guest.cookie?.startsWith("nur_session="));

  const created = await request("/api/conversations", {
    method: "POST",
    body: {},
    cookie: guest.cookie,
  });
  const conversationId = created.data.conversation.id;

  const sent = await request(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    body: { content: "Conta-me sobre Maxixe." },
    cookie: guest.cookie,
  });
  assert.equal(sent.response.status, 201);
  assert.equal(sent.data.messages.length, 2);
  assert.match(sent.data.messages[1].content, /província de Inhambane/i);
  assert.equal(sent.data.aiConfigured, false);

  const history = await request(`/api/conversations/${conversationId}/messages`, {
    cookie: guest.cookie,
  });
  assert.deepEqual(history.data.messages.map((message) => message.role), ["user", "assistant"]);
  assert.equal(history.data.messages[0].content, "Conta-me sobre Maxixe.");
  const listing = await request("/api/conversations", { cookie: guest.cookie });
  assert.equal(listing.data.conversations[0].title, "Conta-me sobre Maxixe.");
});

test("responds naturally to greetings containing accented characters", async () => {
  const guest = await request("/api/auth/guest", { method: "POST", body: {} });
  const conversation = await request("/api/conversations", {
    method: "POST",
    body: {},
    cookie: guest.cookie,
  });
  const reply = await request(`/api/conversations/${conversation.data.conversation.id}/messages`, {
    method: "POST",
    body: { content: "Olá, tudo bem?" },
    cookie: guest.cookie,
  });
  assert.match(reply.data.messages[1].content, /Sou o Nur/i);
});

test("registers, authenticates, validates and terminates user sessions", async () => {
  const account = await request("/api/auth/register", {
    method: "POST",
    body: { name: "Amélia", email: "amelia@example.org", password: "segredo-forte-2026" },
  });
  assert.equal(account.response.status, 201);
  assert.equal(account.data.user.name, "Amélia");

  const duplicate = await request("/api/auth/register", {
    method: "POST",
    body: { name: "Amélia", email: "amelia@example.org", password: "segredo-forte-2026" },
  });
  assert.equal(duplicate.response.status, 409);

  const invalidPassword = await request("/api/auth/register", {
    method: "POST",
    body: { name: "Pessoa", email: "pessoa@example.org", password: "curta" },
  });
  assert.equal(invalidPassword.response.status, 400);

  const incorrectLogin = await request("/api/auth/login", {
    method: "POST",
    body: { email: "amelia@example.org", password: "palavra-errada" },
  });
  assert.equal(incorrectLogin.response.status, 401);

  const login = await request("/api/auth/login", {
    method: "POST",
    body: { email: "amelia@example.org", password: "segredo-forte-2026" },
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.data.user.email, "amelia@example.org");

  const logout = await request("/api/auth/logout", {
    method: "POST",
    body: {},
    cookie: login.cookie,
  });
  assert.equal(logout.response.status, 200);
  const expired = await request("/api/conversations", { cookie: login.cookie });
  assert.equal(expired.response.status, 401);
});

test("saves, reads, replaces and deletes account memory with privacy controls", async () => {
  const account = await request("/api/auth/register", {
    method: "POST",
    body: { name: "Marta", email: "marta.memory@example.org", password: "senha-segura-123" },
  });
  const cookie = account.cookie;

  const initial = await request("/api/memory", { cookie });
  assert.equal(initial.response.status, 200);
  assert.deepEqual(initial.data.items, []);

  const guest = await request("/api/auth/guest", { method: "POST", body: {} });
  const privateMemory = await request("/api/memory", { cookie: guest.cookie });
  assert.equal(privateMemory.response.status, 403);

  const saved = await request("/api/memory", {
    method: "PUT",
    body: {
      items: [
        { category: "interests", content: "Tecnologia\nFutebol" },
        { category: "projects", content: "Criar uma loja online" },
      ],
    },
    cookie,
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.data.items.length, 2);

  const read = await request("/api/memory", { cookie });
  assert.equal(read.data.items.find((item) => item.category === "projects").content, "Criar uma loja online");

  const changed = await request("/api/memory", {
    method: "PUT",
    body: { items: [{ category: "preferences", content: "Prefiro explicações curtas" }] },
    cookie,
  });
  assert.equal(changed.data.items.length, 1);
  assert.equal(changed.data.items[0].category, "preferences");

  const sensitive = await request("/api/memory", {
    method: "PUT",
    body: { items: [{ category: "preferences", content: "A minha palavra-passe é segredo123" }] },
    cookie,
  });
  assert.equal(sensitive.response.status, 400);
  for (const content of [
    "Os meus dados de saúde: saúde muito importante",
    "A minha chave API secreta é abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH",
    "O número do cartão é 1234567890123456",
  ]) {
    const rejected = await request("/api/memory", {
      method: "PUT",
      body: { items: [{ category: "preferences", content }] },
      cookie,
    });
    assert.equal(rejected.response.status, 400, content);
  }

  const deleted = await request("/api/memory", { method: "DELETE", cookie });
  assert.deepEqual(deleted.data.items, []);
  assert.deepEqual((await request("/api/memory", { cookie })).data.items, []);
});

test("edits profile, controls memory use and deletes all conversation history", async () => {
  const account = await request("/api/auth/register", {
    method: "POST",
    body: { name: "Rui", email: "rui.settings@example.org", password: "senha-segura-456" },
  });
  const cookie = account.cookie;

  const profile = await request("/api/profile", {
    method: "PATCH",
    body: { name: "Rui Maxixe" },
    cookie,
  });
  assert.equal(profile.data.profile.name, "Rui Maxixe");
  assert.equal(Object.hasOwn(profile.data.profile, "password_hash"), false);

  const settings = await request("/api/settings", {
    method: "PATCH",
    body: { useMemory: false },
    cookie,
  });
  assert.equal(settings.data.settings.useMemory, false);
  assert.equal((await request("/api/profile", { cookie })).data.settings.useMemory, false);

  const conversation = await request("/api/conversations", {
    method: "POST",
    body: {},
    cookie,
  });
  const cleared = await request("/api/conversations", { method: "DELETE", cookie });
  assert.equal(cleared.response.status, 200);
  assert.deepEqual((await request("/api/conversations", { cookie })).data.conversations, []);
  assert.equal(
    (await request(`/api/conversations/${conversation.data.conversation.id}/messages`, { cookie })).response.status,
    404,
  );
});

test("keeps conversations private, validates messages and deletes history", async () => {
  const firstGuest = await request("/api/auth/guest", { method: "POST", body: {} });
  const firstConversation = await request("/api/conversations", {
    method: "POST",
    body: {},
    cookie: firstGuest.cookie,
  });
  const firstId = firstConversation.data.conversation.id;

  const secondGuest = await request("/api/auth/guest", { method: "POST", body: {} });
  const privateHistory = await request(`/api/conversations/${firstId}/messages`, {
    cookie: secondGuest.cookie,
  });
  assert.equal(privateHistory.response.status, 404);

  const blankMessage = await request(`/api/conversations/${firstId}/messages`, {
    method: "POST",
    body: { content: "  " },
    cookie: firstGuest.cookie,
  });
  assert.equal(blankMessage.response.status, 400);

  const deletion = await request(`/api/conversations/${firstId}`, {
    method: "DELETE",
    cookie: firstGuest.cookie,
  });
  assert.equal(deletion.response.status, 200);
  const deletedHistory = await request(`/api/conversations/${firstId}/messages`, {
    cookie: firstGuest.cookie,
  });
  assert.equal(deletedHistory.response.status, 404);
});

test("handles CORS preflight OPTIONS requests and sets credentials headers", async () => {
  const preflight = await fetch(`${baseUrl}/api/conversations/sample/messages`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://neliaabdala54-web.github.io",
      "Access-Control-Request-Method": "POST",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://neliaabdala54-web.github.io");
  assert.equal(preflight.headers.get("access-control-allow-credentials"), "true");
  assert.match(preflight.headers.get("access-control-allow-methods"), /POST/);

  const guest = await fetch(`${baseUrl}/api/auth/guest`, {
    method: "POST",
    headers: {
      Origin: "https://neliaabdala54-web.github.io",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(guest.status, 201);
  assert.equal(guest.headers.get("access-control-allow-origin"), "https://neliaabdala54-web.github.io");
  assert.equal(guest.headers.get("access-control-allow-credentials"), "true");
});
