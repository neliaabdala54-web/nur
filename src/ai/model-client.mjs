import { checkSafety, isSafeModelResponse } from "./safety.mjs";

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) {
    throw new Error("As mensagens enviadas ao modelo não são válidas.");
  }

  return messages
    .map((message) => {
      const role = typeof message?.role === "string" ? message.role : "user";
      const content = Array.isArray(message?.content)
        ? message.content
            .map((part) => (typeof part === "string" ? part : part?.text || ""))
            .join("\n")
        : String(message?.content ?? "");

      return { role, content };
    })
    .filter((message) => message.content.trim().length > 0);
}

function extractAnswerFromPayload(data) {
  const messageContent = data?.choices?.[0]?.message?.content;
  if (typeof messageContent === "string") return messageContent;
  if (Array.isArray(messageContent)) {
    return messageContent
      .map((part) => (typeof part === "string" ? part : part?.text || ""))
      .join("\n");
  }
  if (Array.isArray(data?.candidates)) {
    const candidateText = data.candidates[0]?.content?.parts;
    if (Array.isArray(candidateText)) {
      return candidateText
        .map((part) => (typeof part === "string" ? part : part?.text || ""))
        .join("\n");
    }
  }
  if (typeof data?.answer === "string") return data.answer;
  throw new Error("O serviço de IA devolveu uma resposta vazia ou num formato inesperado.");
}

function normalizeGoogleContents(messages) {
  const contents = [];
  const systemInstructions = [];

  for (const message of messages) {
    if (message.role === "system") {
      systemInstructions.push(message.content);
      continue;
    }

    const role = message.role === "assistant" ? "model" : "user";
    const previous = contents.at(-1);
    if (previous?.role === role) {
      previous.parts[0].text += `\n${message.content}`;
    } else {
      contents.push({ role, parts: [{ text: message.content }] });
    }
  }

  return {
    contents,
    systemInstruction: systemInstructions.length
      ? { parts: [{ text: systemInstructions.join("\n\n") }] }
      : undefined,
  };
}

function extractGroundedSources(candidate, retrievedAt) {
  const chunks = candidate?.groundingMetadata?.groundingChunks;
  const supports = candidate?.groundingMetadata?.groundingSupports;
  if (!Array.isArray(chunks)) return [];

  const excerpts = new Map();
  if (Array.isArray(supports)) {
    for (const support of supports) {
      const excerpt = typeof support?.segment?.text === "string"
        ? support.segment.text.trim()
        : "";
      if (!excerpt || !Array.isArray(support.groundingChunkIndices)) continue;
      for (const index of support.groundingChunkIndices) {
        excerpts.set(index, [excerpts.get(index), excerpt].filter(Boolean).join(" "));
      }
    }
  }

  const seen = new Set();
  return chunks.flatMap((chunk, index) => {
    const web = chunk?.web;
    if (typeof web?.uri !== "string" || typeof web.title !== "string") return [];
    let url;
    try {
      url = new URL(web.uri);
    } catch {
      return [];
    }
    if (
      url.protocol !== "https:"
      || !url.hostname
      || url.username
      || url.password
      || url.hostname === "localhost"
      || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname)
      || seen.has(url.href)
    ) return [];
    seen.add(url.href);
    return [{
      title: (web.title.trim() || url.hostname).slice(0, 240),
      url: url.href,
      excerpt: (excerpts.get(index) || "").slice(0, 1200),
      publishedAt: null,
      retrievedAt,
      isCurrent: true,
    }];
  });
}

function getAiApiKey(environment) {
  return String(environment.GEMINI_API_KEY || "").trim()
    || String(environment.AI_API_KEY || "").trim();
}

function redactProviderMessage(message, apiKey) {
  return String(message || "Sem detalhe adicional.")
    .replaceAll(apiKey, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b(?:[A-Z0-9_]*API[_ -]?KEY|key|token)\s*[:=]\s*["']?[^ "'&,;]+/gi, "credential=[redacted]")
    .slice(0, 500);
}

export function hasAiApiKey(environment = process.env) {
  return Boolean(getAiApiKey(environment));
}

export async function generateWithModel(messages, {
  environment = process.env,
  fetchImpl = fetch,
  responseFormat,
  googleSearch = false,
  includeGroundingMetadata = false,
  timeoutMs = 30_000,
} = {}) {
  const normalizedMessages = normalizeMessages(messages);
  const promptText = normalizedMessages
    .filter((message) => message.role !== "system")
    .map((message) => message.content)
    .join("\n");
  const safetyCheck = checkSafety(promptText);
  if (safetyCheck.response) {
    throw new Error(safetyCheck.response);
  }

  const apiKey = getAiApiKey(environment);
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY não configurada.");
  }

  const baseUrl = (environment.AI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/+$/, "");
  let parsedBaseUrl;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    throw new Error("A URL da API de IA está inválida.");
  }
  if (parsedBaseUrl.protocol !== "https:") {
    throw new Error("A API de IA deve usar HTTPS para proteger a chave.");
  }

  const isGeminiEndpoint = parsedBaseUrl.hostname === "generativelanguage.googleapis.com";
  const model = environment.AI_MODEL || "gemini-3.1-flash-lite";
  if (googleSearch && !isGeminiEndpoint) {
    throw new Error("Google Search Grounding requer o endpoint oficial da Gemini.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const googleContents = googleSearch ? normalizeGoogleContents(normalizedMessages) : null;
      const endpoint = googleSearch
        ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
        : `${baseUrl}/chat/completions`;
      const headers = googleSearch
        ? { "x-goog-api-key": apiKey, "Content-Type": "application/json" }
        : {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        };
      const body = googleSearch
        ? {
          ...googleContents,
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0.7,
            ...(responseFormat?.type === "json_object" ? { responseMimeType: "application/json" } : {}),
          },
        }
        : {
          model,
          ...(isGeminiEndpoint ? { reasoning_effort: "low" } : {}),
          messages: normalizedMessages,
          ...(responseFormat ? { response_format: responseFormat } : {}),
          temperature: 0.7,
        };
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.ok || ![502, 503, 504].includes(response.status) || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
    }
    if (!response.ok) {
      const responseText = await response.text().catch(() => "");
      let providerError;
      try {
        const errorPayload = JSON.parse(responseText);
        providerError = Array.isArray(errorPayload)
          ? errorPayload[0]?.error
          : errorPayload?.error;
      } catch {
        providerError = null;
      }
      const providerType = typeof providerError?.status === "string"
        ? providerError.status
        : typeof providerError?.type === "string"
          ? providerError.type
          : response.statusText || "HTTP error";
      const providerMessage = redactProviderMessage(
        providerError?.message || responseText || response.statusText,
        apiKey,
      );
      const error = new Error(
        `Gemini HTTP ${response.status} (${providerType}) no modelo ${model}: ${providerMessage}`,
      );
      error.status = response.status;
      error.providerType = providerType;
      error.providerMessage = providerMessage;
      error.model = model;
      throw error;
    }
    const data = await response.json();
    const candidate = data?.candidates?.[0];
    const answer = googleSearch
      ? candidate?.content?.parts
        ?.map((part) => (typeof part?.text === "string" ? part.text : ""))
        .filter(Boolean)
        .join("\n")
      : extractAnswerFromPayload(data);
    if (typeof answer !== "string" || !answer.trim()) {
      throw new Error("O serviço de IA devolveu uma resposta vazia.");
    }
    if (!isSafeModelResponse(answer)) {
      throw new Error("A resposta do serviço de IA foi bloqueada por validação de segurança.");
    }
    if (includeGroundingMetadata) {
      const retrievedAt = new Date().toISOString();
      const sources = extractGroundedSources(candidate, retrievedAt);
      return {
        answer: answer.trim(),
        sources,
        retrievedAt,
        hasCurrentEvidence: sources.length > 0,
      };
    }
    return answer.trim();
  } finally {
    clearTimeout(timeout);
  }
}
