import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { generateReply } from "./src/ai/index.mjs";
import { hasAiApiKey } from "./src/ai/model-client.mjs";
import { validateUploadedAttachments } from "./src/media-input.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = resolve(root, "public");
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MULTIMODAL_BODY_BYTES = 18 * 1024 * 1024;
const SESSION_AGE = 30 * 24 * 60 * 60;
const MESSAGE_RATE_LIMIT = 8;
const MESSAGE_RATE_WINDOW_MS = 60_000;
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function loadEnvironment() {
  const envFile = resolve(root, ".env");
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !Object.hasOwn(process.env, match[1])) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
}

loadEnvironment();

function openDatabase(directoryPath = process.env.DATA_DIR || ".data") {
  const directory = resolve(root, directoryPath);
  mkdirSync(directory, { recursive: true });
  const database = new DatabaseSync(resolve(directory, "bot-nur.sqlite"));
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'Nova conversa',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS user_memory (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL CHECK (category IN ('interests', 'goals', 'preferences', 'favorite_topics', 'projects')),
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, category)
    );
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      use_memory INTEGER NOT NULL DEFAULT 1 CHECK (use_memory IN (0, 1)),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_user
      ON conversations(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_expiry
      ON sessions(expires_at);
  `);
  database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Math.floor(Date.now() / 1000));
  return database;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const jsonHeaders = { "Cache-Control": "no-store" };
const MEMORY_CATEGORIES = new Set([
  "interests",
  "goals",
  "preferences",
  "favorite_topics",
  "projects",
]);
const SENSITIVE_MEMORY = /\b(?:password|senha|palavra[- ]passe|api[-_ ]?key|chave (?:de api|secreta|privada)|token secreto|cartao(?: bancario)?|conta bancaria|numero de conta|iban|nib|pin|salario|rendimento|divida|credito|dados financeiros|financas pessoais|dinheiro|diagnostico|doenca|medicacao|historico medico|saude|sexualidade|orientacao sexual|religiao|partido politico|etnia|endereco de casa|morada de casa)\b/i;

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    ...jsonHeaders,
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

async function readJson(request, maxBodyBytes = MAX_BODY_BYTES) {
  const declaredSize = Number(request.headers["content-length"] || 0);
  if (declaredSize > maxBodyBytes) {
    throw new HttpError(413, "A mensagem é demasiado grande.");
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      throw new HttpError(413, "A mensagem é demasiado grande.");
    }
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("JSON object required");
    }
    return value;
  } catch {
    throw new HttpError(400, "Não foi possível ler os dados enviados.");
  }
}

function createId() {
  return randomBytes(18).toString("base64url");
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function sessionCookie(request, token) {
  const secure = process.env.NODE_ENV === "production" || Boolean(request.socket.encrypted);
  return `nur_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_AGE}${secure ? "; Secure" : ""}`;
}

function clearSessionCookie(request) {
  const secure = process.env.NODE_ENV === "production" || Boolean(request.socket.encrypted);
  return `nur_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? "; Secure" : ""}`;
}

function getSessionUser(request, database) {
  const token = request.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("nur_session="))
    ?.slice("nur_session=".length);
  if (!token) return null;
  return database.prepare(`
    SELECT users.id, users.name, users.email
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(tokenHash(token), Math.floor(Date.now() / 1000)) ?? null;
}

function beginSession(response, request, database, userId) {
  const token = randomBytes(32).toString("base64url");
  database.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
  ).run(tokenHash(token), userId, Math.floor(Date.now() / 1000) + SESSION_AGE);
  response.setHeader("Set-Cookie", sessionCookie(request, token));
}

function requireAccount(user) {
  if (!user) throw new HttpError(401, "A tua sessão expirou. Volta a ligar-te.");
  if (!user.email) throw new HttpError(403, "Cria uma conta para guardar memória pessoal.");
}

function getAiErrorMessage(error) {
  if (error.code === "AI_MEDIA_REJECTED") {
    return "Neste momento não consigo analisar este formato ou tamanho de ficheiro com o modelo Gemini configurado.";
  }
  if (error.code === "AI_MEDIA_NOT_CONFIGURED") {
    return "Não consigo analisar ficheiros sem a configuração Gemini do servidor. O administrador tem de configurar a IA.";
  }
  if (error.code === "AI_MEDIA_UNSUPPORTED") {
    return "Este tipo de análise não está disponível com a configuração Gemini atual.";
  }
  if (error.name === "AbortError") {
    return "A Gemini demorou demasiado a responder. Tenta novamente dentro de instantes.";
  }
  if (error.status === 429) {
    return "O limite de utilização da Gemini foi atingido. Tenta mais tarde ou verifica a quota da API.";
  }
  if (error.status === 401 || error.status === 403) {
    return "A configuração Gemini não foi autorizada. O administrador deve verificar as credenciais e permissões do serviço.";
  }
  if (error.status === 400) {
    return "A Gemini rejeitou este pedido. Tenta reformular a mensagem ou pede ao administrador para verificar o modelo configurado.";
  }
  if (Number.isInteger(error.status) && error.status >= 500) {
    return `A Gemini está temporariamente indisponível (HTTP ${error.status}). Tenta novamente mais tarde.`;
  }
  if (error.message === "GEMINI_API_KEY não configurada.") {
    return "O serviço de IA não está configurado neste momento. Informa o administrador.";
  }
  return "Não foi possível obter uma resposta da Gemini. Tenta novamente dentro de instantes.";
}

function readUserMemory(database, userId) {
  return database.prepare(`
    SELECT category, content, updated_at AS updatedAt
    FROM user_memory WHERE user_id = ? ORDER BY category
  `).all(userId);
}

function validateMemoryItems(items) {
  if (!Array.isArray(items) || items.length > MEMORY_CATEGORIES.size) {
    throw new HttpError(400, "A memória deve conter até cinco categorias permitidas.");
  }
  const seen = new Set();
  return items.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new HttpError(400, "Cada memória deve ter uma categoria e um texto.");
    }
    const { category } = item;
    if (typeof item.content !== "string") {
      throw new HttpError(400, "O conteúdo de cada memória deve ser texto.");
    }
    const content = item.content.trim();
    if (!MEMORY_CATEGORIES.has(category) || seen.has(category)) {
      throw new HttpError(400, "A categoria de memória é inválida ou está repetida.");
    }
    if (content.length > 1200) {
      throw new HttpError(400, "Cada categoria de memória pode ter até 1 200 caracteres.");
    }
    const normalizedContent = content.normalize("NFD").replace(/\p{M}/gu, "");
    if (
      SENSITIVE_MEMORY.test(normalizedContent)
      || /\b[A-Za-z0-9_-]{40,}\b/.test(content)
      || /\b\d{13,19}\b/.test(content)
    ) {
      throw new HttpError(400, "Não guardes palavras-passe, chaves, dados financeiros, de saúde ou outras informações sensíveis na memória.");
    }
    seen.add(category);
    return { category, content };
  }).filter((item) => item.content);
}

async function serveStatic(pathname, response, method) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, "O endereço pedido é inválido.");
  }
  if (decoded.includes("\0") || decoded.includes("\\")) {
    throw new HttpError(400, "O endereço pedido é inválido.");
  }
  const relativePath = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const filename = resolve(publicDir, relativePath);
  if (!filename.startsWith(`${publicDir}${sep}`)) {
    throw new HttpError(404, "Página não encontrada.");
  }
  let contents;
  try {
    contents = await readFile(filename);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      throw new HttpError(404, "Página não encontrada.");
    }
    throw error;
  }
  response.writeHead(200, {
    "Cache-Control": filename.endsWith(".html") ? "no-cache" : "public, max-age=3600",
    "Content-Type": MIME_TYPES[extname(filename)] || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    "X-Frame-Options": "DENY",
  });
  response.end(method === "HEAD" ? undefined : contents);
}

export function createAppServer({ dataDir, generateReplyImpl = generateReply } = {}) {
  const database = openDatabase(dataDir);
  const messageRequests = new Map();
  let activeMediaRequests = 0;
  const statements = {
    conversation: database.prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ?"),
    insertMessage: database.prepare(
      "INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)",
    ),
  };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      const path = url.pathname;
      const method = request.method;

      if (path === "/health" && method === "GET") {
        sendJson(response, 200, { status: "ok" });
        return;
      }

      if (path === "/api/health" && method === "GET") {
        sendJson(response, 200, { status: "ok", aiConfigured: hasAiApiKey() });
        return;
      }

      if (path === "/api/session" && method === "GET") {
        sendJson(response, 200, { user: getSessionUser(request, database) });
        return;
      }

      if (path === "/api/profile" && (method === "GET" || method === "PATCH")) {
        const user = getSessionUser(request, database);
        if (!user) throw new HttpError(401, "A tua sessão expirou. Volta a ligar-te.");
        if (method === "PATCH") {
          const body = await readJson(request);
          const name = typeof body.name === "string" ? body.name.trim() : "";
          if (name.length < 2 || name.length > 50) {
            throw new HttpError(400, "O nome deve ter entre 2 e 50 caracteres.");
          }
          database.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, user.id);
          sendJson(response, 200, {
            profile: database.prepare("SELECT id, name, email FROM users WHERE id = ?").get(user.id),
          });
          return;
        }
        const settings = database.prepare(
          "SELECT use_memory AS useMemory FROM user_settings WHERE user_id = ?",
        ).get(user.id);
        sendJson(response, 200, {
          profile: user,
          settings: { useMemory: Boolean(user.email && (settings?.useMemory ?? 1)) },
        });
        return;
      }

      if (path === "/api/settings" && method === "PATCH") {
        const user = getSessionUser(request, database);
        requireAccount(user);
        const body = await readJson(request);
        if (typeof body.useMemory !== "boolean") {
          throw new HttpError(400, "Indica se queres permitir o uso da memória contextual.");
        }
        database.prepare(`
          INSERT INTO user_settings (user_id, use_memory, updated_at)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(user_id) DO UPDATE SET
            use_memory = excluded.use_memory,
            updated_at = datetime('now')
        `).run(user.id, Number(body.useMemory));
        sendJson(response, 200, { settings: { useMemory: body.useMemory } });
        return;
      }

      if (path === "/api/memory" && (method === "GET" || method === "PUT" || method === "DELETE")) {
        const user = getSessionUser(request, database);
        requireAccount(user);
        if (method === "GET") {
          sendJson(response, 200, { items: readUserMemory(database, user.id) });
          return;
        }
        if (method === "DELETE") {
          database.prepare("DELETE FROM user_memory WHERE user_id = ?").run(user.id);
          sendJson(response, 200, { items: [] });
          return;
        }
        const body = await readJson(request);
        const items = validateMemoryItems(body.items);
        database.exec("BEGIN");
        try {
          database.prepare("DELETE FROM user_memory WHERE user_id = ?").run(user.id);
          const insert = database.prepare(`
            INSERT INTO user_memory (user_id, category, content, updated_at)
            VALUES (?, ?, ?, datetime('now'))
          `);
          for (const item of items) insert.run(user.id, item.category, item.content);
          database.exec("COMMIT");
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
        sendJson(response, 200, { items: readUserMemory(database, user.id) });
        return;
      }

      if (path === "/api/auth/guest" && method === "POST") {
        const currentUser = getSessionUser(request, database);
        if (currentUser) {
          sendJson(response, 200, { user: currentUser });
          return;
        }
        const userId = createId();
        database.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run(userId, "Visitante");
        beginSession(response, request, database, userId);
        sendJson(response, 201, { user: database.prepare("SELECT id, name, email FROM users WHERE id = ?").get(userId) });
        return;
      }

      if (path === "/api/auth/register" && method === "POST") {
        const body = await readJson(request);
        const name = typeof body.name === "string" ? body.name.trim() : "";
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        const password = typeof body.password === "string" ? body.password : "";
        if (name.length < 2 || name.length > 50) {
          throw new HttpError(400, "O nome deve ter entre 2 e 50 caracteres.");
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
          throw new HttpError(400, "Introduz um endereço de email válido.");
        }
        if (password.length < 8 || Buffer.byteLength(password, "utf8") > 1024) {
          throw new HttpError(400, "A palavra-passe deve ter pelo menos 8 caracteres.");
        }
        const salt = randomBytes(16).toString("hex");
        const passwordHash = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
        const userId = createId();
        try {
          database.prepare("INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)")
            .run(userId, name, email, passwordHash);
        } catch (error) {
          if (error.code === "ERR_SQLITE_ERROR" && error.message.includes("UNIQUE")) {
            throw new HttpError(409, "Já existe uma conta com esse email.");
          }
          throw error;
        }
        beginSession(response, request, database, userId);
        sendJson(response, 201, { user: { id: userId, name, email } });
        return;
      }

      if (path === "/api/auth/login" && method === "POST") {
        const body = await readJson(request);
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        const password = typeof body.password === "string" ? body.password : "";
        const account = database.prepare(
          "SELECT id, name, email, password_hash FROM users WHERE email = ?",
        ).get(email);
        let valid = false;
        if (account?.password_hash && password.length <= 1024) {
          const [salt, storedHash] = account.password_hash.split(":");
          const candidate = scryptSync(password, salt, 64);
          const expected = Buffer.from(storedHash, "hex");
          valid = candidate.length === expected.length && timingSafeEqual(candidate, expected);
        }
        if (!valid) throw new HttpError(401, "Email ou palavra-passe incorretos.");
        beginSession(response, request, database, account.id);
        sendJson(response, 200, { user: { id: account.id, name: account.name, email: account.email } });
        return;
      }

      if (path === "/api/auth/logout" && method === "POST") {
        const user = getSessionUser(request, database);
        if (user) {
          const token = request.headers.cookie
            ?.split(";")
            .map((part) => part.trim())
            .find((part) => part.startsWith("nur_session="))
            ?.slice("nur_session=".length);
          if (token) database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
        }
        response.setHeader("Set-Cookie", clearSessionCookie(request));
        sendJson(response, 200, { ok: true });
        return;
      }

      if (path === "/api/conversations" && method === "GET") {
        const user = getSessionUser(request, database);
        if (!user) throw new HttpError(401, "A tua sessão expirou. Volta a ligar-te.");
        const conversations = database.prepare(`
          SELECT id, title, created_at AS createdAt, updated_at AS updatedAt
          FROM conversations WHERE user_id = ? ORDER BY updated_at DESC
        `).all(user.id);
        sendJson(response, 200, { conversations });
        return;
      }

      if (path === "/api/conversations" && method === "DELETE") {
        const user = getSessionUser(request, database);
        if (!user) throw new HttpError(401, "A tua sessão expirou. Volta a ligar-te.");
        database.prepare("DELETE FROM conversations WHERE user_id = ?").run(user.id);
        sendJson(response, 200, { ok: true });
        return;
      }

      if (path === "/api/conversations" && method === "POST") {
        const user = getSessionUser(request, database);
        if (!user) throw new HttpError(401, "A tua sessão expirou. Volta a ligar-te.");
        const id = createId();
        database.prepare("INSERT INTO conversations (id, user_id) VALUES (?, ?)").run(id, user.id);
        sendJson(response, 201, {
          conversation: database.prepare(
            "SELECT id, title, created_at AS createdAt, updated_at AS updatedAt FROM conversations WHERE id = ?",
          ).get(id),
        });
        return;
      }

      const conversationMatch = path.match(/^\/api\/conversations\/([A-Za-z0-9_-]+)$/);
      if (conversationMatch && method === "DELETE") {
        const user = getSessionUser(request, database);
        if (!user) throw new HttpError(401, "A tua sessão expirou. Volta a ligar-te.");
        const deletion = database.prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?")
          .run(conversationMatch[1], user.id);
        if (!deletion.changes) throw new HttpError(404, "Esta conversa não existe.");
        sendJson(response, 200, { ok: true });
        return;
      }

      const messagesMatch = path.match(/^\/api\/conversations\/([A-Za-z0-9_-]+)\/messages$/);
      if (messagesMatch && method === "GET") {
        const user = getSessionUser(request, database);
        if (!user) throw new HttpError(401, "A tua sessão expirou. Volta a ligar-te.");
        const conversationId = messagesMatch[1];
        if (!statements.conversation.get(conversationId, user.id)) {
          throw new HttpError(404, "Esta conversa não existe.");
        }
        const messages = database.prepare(`
          SELECT id, role, content, created_at AS createdAt
          FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC
        `).all(conversationId);
        sendJson(response, 200, { messages });
        return;
      }

      if (messagesMatch && method === "POST") {
        const user = getSessionUser(request, database);
        if (!user) throw new HttpError(401, "A tua sessão expirou. Volta a ligar-te.");
        const body = await readJson(request, MAX_MULTIMODAL_BODY_BYTES);
        const content = typeof body.content === "string" ? body.content.trim() : "";
        if (content.length > 4000) {
          throw new HttpError(400, "A mensagem deve ter entre 1 e 4 000 caracteres.");
        }
        let attachments;
        try {
          attachments = validateUploadedAttachments(body.attachments ?? []);
        } catch (error) {
          if (error.code === "INVALID_MEDIA") {
            throw new HttpError(error.status || 400, error.message);
          }
          throw error;
        }
        if (!content && attachments.length === 0) {
          throw new HttpError(400, "Escreve uma mensagem ou anexa um ficheiro.");
        }
        const effectiveContent = content || "Analisa o conteúdo do(s) ficheiro(s) anexado(s).";
        const conversationId = messagesMatch[1];
        if (!statements.conversation.get(conversationId, user.id)) {
          throw new HttpError(404, "Esta conversa não existe.");
        }
        const now = Date.now();
        const recentRequests = (messageRequests.get(user.id) || [])
          .filter((timestamp) => now - timestamp < MESSAGE_RATE_WINDOW_MS);
        if (recentRequests.length >= MESSAGE_RATE_LIMIT) {
          throw new HttpError(429, "O Nur recebeu muitas mensagens em pouco tempo. Espera um minuto e tenta novamente.");
        }
        if (attachments.length && activeMediaRequests >= 4) {
          throw new HttpError(429, "O Nur está a analisar vários ficheiros neste momento. Tenta novamente dentro de instantes.");
        }
        recentRequests.push(now);
        messageRequests.set(user.id, recentRequests);

        const messageId = createId();
        const existingCount = database.prepare(
          "SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?",
        ).get(conversationId).count;
        const replyHistory = database.prepare(`
          SELECT role, content FROM messages
          WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 16
        `).all(conversationId).reverse();
        const settings = database.prepare(
          "SELECT use_memory AS useMemory FROM user_settings WHERE user_id = ?",
        ).get(user.id);
        const userMemory = user.email && (settings?.useMemory ?? 1)
          ? readUserMemory(database, user.id)
          : [];
        const attachmentLabels = attachments.length
          ? `\n\n[Ficheiros analisados nesta mensagem: ${attachments.map(({ name }) => name).join(", ")}. Os ficheiros originais não ficam guardados no histórico.]`
          : "";
        statements.insertMessage.run(
          messageId,
          conversationId,
          "user",
          `${effectiveContent}${attachmentLabels}`,
        );
        database.prepare(`
          UPDATE conversations SET updated_at = datetime('now'),
            title = CASE WHEN ? = 0 THEN ? ELSE title END
          WHERE id = ? AND user_id = ?
        `).run(existingCount, effectiveContent.slice(0, 64), conversationId, user.id);

        const includesMedia = attachments.length > 0;
        if (includesMedia) activeMediaRequests += 1;
        const generationAbortController = includesMedia ? new AbortController() : null;
        const abortGeneration = () => generationAbortController?.abort();
        if (generationAbortController) response.once("close", abortGeneration);
        let reply;
        try {
          reply = await generateReplyImpl(effectiveContent, replyHistory, {
            userMemory,
            media: attachments,
            signal: generationAbortController?.signal,
          });
        } catch (error) {
          if (!generationAbortController?.signal.aborted) {
            console.error("[bot-nur] Falha ao gerar resposta:", {
              name: error.name,
              status: Number.isInteger(error.status) ? error.status : undefined,
              providerType: typeof error.providerType === "string" ? error.providerType : undefined,
              model: typeof error.model === "string" ? error.model : undefined,
            });
          }
          const status = error.status === 429
            ? 429
            : error.code === "AI_MEDIA_NOT_CONFIGURED"
              ? 503
              : 502;
          throw new HttpError(status, getAiErrorMessage(error));
        } finally {
          if (generationAbortController) response.removeListener("close", abortGeneration);
          if (includesMedia) activeMediaRequests -= 1;
        }
        const assistantMessage = {
          id: createId(),
          role: "assistant",
          content: reply,
          createdAt: new Date().toISOString().replace("T", " ").slice(0, 19),
        };
        statements.insertMessage.run(
          assistantMessage.id,
          conversationId,
          "assistant",
          assistantMessage.content,
        );
        database.prepare(
          "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?",
        ).run(conversationId);
        sendJson(response, 201, {
          messages: [
            {
              id: messageId,
              role: "user",
              content: `${effectiveContent}${attachmentLabels}`,
              createdAt: new Date().toISOString(),
            },
            assistantMessage,
          ],
          aiConfigured: hasAiApiKey(),
        });
        return;
      }

      if (path.startsWith("/api/")) {
        sendJson(response, 404, { error: "Este endereço da API não existe." });
        return;
      }
      if (method !== "GET" && method !== "HEAD") {
        throw new HttpError(405, "Este método não é permitido.");
      }
      await serveStatic(path, response, method);
    } catch (error) {
      if (request.aborted || response.destroyed) return;
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error("[bot-nur] Erro inesperado:", error);
      if (!response.headersSent) {
        sendJson(response, status, {
          error: status === 500 ? "Ocorreu um erro inesperado. Tenta novamente." : error.message,
        });
      } else {
        response.destroy();
      }
    }
  });

  server.on("close", () => database.close());
  return server;
}

const invokedFile = process.argv[1] && resolve(process.argv[1]);
if (invokedFile === resolve(fileURLToPath(import.meta.url))) {
  const server = createAppServer();
  const port = Number(process.env.PORT || 3000);
  const isProduction = process.env.NODE_ENV === "production" || process.env.RENDER === "true";
  const host = isProduction ? "0.0.0.0" : process.env.HOST || "127.0.0.1";
  server.listen(port, host, () => {
    console.log(`Bot Nur a escutar em ${host}:${port}`);
  });
}
