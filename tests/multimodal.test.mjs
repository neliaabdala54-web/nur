import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createAppServer } from "../server.mjs";
import { validateUploadedAttachments } from "../src/media-input.mjs";
import { generateWithModel } from "../src/ai/model-client.mjs";
import { generateReply } from "../src/ai/generate-reply.mjs";

const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const imageAttachment = {
  name: "foto.jpg",
  mimeType: "image/jpeg",
  data: imageBytes.toString("base64"),
};

test("validates safe media extensions, signatures, sizes and text encoding", () => {
  const [image] = validateUploadedAttachments([imageAttachment]);
  assert.equal(image.name, "foto.jpg");
  assert.equal(image.category, "image");
  assert.equal(image.mimeType, "image/jpeg");
  assert.equal(image.data, imageAttachment.data);

  const [text] = validateUploadedAttachments([{
    name: "notas.txt",
    mimeType: "text/plain",
    data: Buffer.from("Resumo de aula", "utf8").toString("base64"),
  }]);
  assert.equal(text.text, "Resumo de aula");

  assert.throws(
    () => validateUploadedAttachments([{ ...imageAttachment, name: "imagem.exe" }]),
    /Formato não suportado/,
  );
  assert.throws(
    () => validateUploadedAttachments([{ ...imageAttachment, data: Buffer.from("not an image").toString("base64") }]),
    /não corresponde/,
  );
  assert.throws(
    () => validateUploadedAttachments(Array.from({ length: 4 }, (_, index) => ({
      ...imageAttachment,
      name: `foto${index}.jpg`,
    }))),
    /no máximo 3/,
  );
  assert.throws(
    () => validateUploadedAttachments([{
      name: "grande.png",
      mimeType: "image/png",
      data: Buffer.alloc(5 * 1024 * 1024 + 1, 1).toString("base64"),
    }]),
    (error) => error.status === 413,
  );
});

test("sends real inline file parts through Gemini generateContent without exposing the key to a browser", async () => {
  let calledUrl;
  let calledOptions;
  const answer = await generateWithModel([
    { role: "system", content: "Analisa o ficheiro enviado." },
    { role: "user", content: "O que aparece na imagem?" },
  ], {
    environment: {
      GEMINI_API_KEY: "server-only-test-secret",
      AI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai",
      AI_MODEL: "gemini-3.1-flash-lite",
    },
    media: [validateUploadedAttachments([imageAttachment])[0]],
    fetchImpl: async (url, options) => {
      calledUrl = url;
      calledOptions = options;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "Vejo uma imagem enviada." }] } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  assert.match(calledUrl, /models\/gemini-3\.1-flash-lite:generateContent$/);
  assert.equal(calledOptions.headers["x-goog-api-key"], "server-only-test-secret");
  assert.equal(Object.hasOwn(calledOptions.headers, "Authorization"), false);
  const payload = JSON.parse(calledOptions.body);
  assert.equal(payload.contents.at(-1).parts.at(-1).inline_data.mime_type, "image/jpeg");
  assert.equal(payload.contents.at(-1).parts.at(-1).inline_data.data, imageAttachment.data);
  assert.equal(answer, "Vejo uma imagem enviada.");
});

test("sends audio, video and PDF inputs as Gemini inline media parts", async () => {
  const inputs = [
    {
      name: "voz.mp3",
      mimeType: "audio/mpeg",
      data: Buffer.from("ID3voice").toString("base64"),
    },
    {
      name: "clip.mp4",
      mimeType: "video/mp4",
      data: Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]).toString("base64"),
    },
    {
      name: "trabalho.pdf",
      mimeType: "application/pdf",
      data: Buffer.from("%PDF-1.7\n").toString("base64"),
    },
  ];
  const media = validateUploadedAttachments(inputs);
  let parts;
  await generateWithModel([{ role: "user", content: "Analisa estes anexos." }], {
    environment: {
      GEMINI_API_KEY: "server-only-test-secret",
      AI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai",
    },
    media,
    fetchImpl: async (_url, options) => {
      parts = JSON.parse(options.body).contents[0].parts;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "Consegui processar os anexos." }] } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  assert.deepEqual(
    parts.slice(1).map((part) => part.inline_data.mime_type),
    ["audio/mp3", "video/mp4", "application/pdf"],
  );
});

test("does not claim it can analyze files when no server Gemini key is configured", async () => {
  await assert.rejects(
    generateReply("Analisa esta imagem.", [], {
      environment: { GEMINI_API_KEY: "", AI_API_KEY: "" },
      media: [validateUploadedAttachments([imageAttachment])[0]],
    }),
    (error) => error.code === "AI_MEDIA_NOT_CONFIGURED" && error.status === 503,
  );
});

test("propagates cancellation to an in-flight Gemini upload request", async () => {
  const cancellation = new AbortController();
  const pending = generateWithModel([{ role: "user", content: "Analisa o anexo." }], {
    environment: {
      GEMINI_API_KEY: "server-only-test-secret",
      AI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai",
    },
    media: [validateUploadedAttachments([imageAttachment])[0]],
    signal: cancellation.signal,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener(
        "abort",
        () => reject(options.signal.reason),
        { once: true },
      );
      setTimeout(() => cancellation.abort(), 0);
    }),
  });
  await assert.rejects(pending, (error) => error.name === "AbortError");
});

const dataDir = await mkdtemp(join(tmpdir(), "bot-nur-multimodal-test-"));
let server;
let baseUrl;
let generatedMedia;
let generationCount = 0;

before(async () => {
  server = createAppServer({
    dataDir,
    generateReplyImpl: async (_content, _history, options) => {
      generatedMedia = options.media;
      generationCount += 1;
      return "Analisei o ficheiro enviado.";
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await rm(dataDir, { recursive: true, force: true });
});

async function request(path, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    signal: AbortSignal.timeout(5000),
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

test("keeps uploaded media ephemeral, wires it to the reply pipeline, and rate limits messages", async () => {
  const guest = await request("/api/auth/guest", { method: "POST", body: {} });
  const conversation = await request("/api/conversations", {
    method: "POST",
    body: {},
    cookie: guest.cookie,
  });
  const path = `/api/conversations/${conversation.data.conversation.id}/messages`;
  const sent = await request(path, {
    method: "POST",
    body: { content: "O que aparece nesta imagem?", attachments: [imageAttachment] },
    cookie: guest.cookie,
  });
  assert.equal(sent.response.status, 201);
  assert.equal(generatedMedia[0].name, "foto.jpg");
  assert.equal(sent.data.messages[1].content, "Analisei o ficheiro enviado.");

  const history = await request(path, { cookie: guest.cookie });
  assert.match(history.data.messages[0].content, /foto\.jpg/);
  assert.doesNotMatch(JSON.stringify(history.data.messages), new RegExp(imageAttachment.data));

  const beforeInvalid = generationCount;
  const invalid = await request(path, {
    method: "POST",
    body: {
      content: "Analisa isto",
      attachments: [{ ...imageAttachment, data: Buffer.from("invalid image").toString("base64") }],
    },
    cookie: guest.cookie,
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(generationCount, beforeInvalid);

  for (let index = 1; index < 8; index += 1) {
    const accepted = await request(path, {
      method: "POST",
      body: { content: `Mensagem ${index}` },
      cookie: guest.cookie,
    });
    assert.equal(accepted.response.status, 201);
  }
  const limited = await request(path, {
    method: "POST",
    body: { content: "Mais uma mensagem" },
    cookie: guest.cookie,
  });
  assert.equal(limited.response.status, 429);
});
