const MAX_CONTEXT_MESSAGES = 12;
const MAX_CONTEXT_CHARS = 4000;
const MAX_RELEVANT_CONTEXT_MESSAGES = 8;
const HISTORY_NOISE = new Set([
  "com", "como", "de", "do", "da", "dos", "das", "em", "no", "na",
  "os", "as", "um", "uma", "que", "qual", "quais", "para", "por",
  "me", "te", "eu", "tu", "voce", "você", "sobre", "mais", "isto",
]);

function messageTokens(value) {
  return new Set(String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-MZ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3 && !HISTORY_NOISE.has(token)));
}

function tokenMatches(first, second) {
  return first === second
    || first.length >= 5 && second.length >= 5
      && (first.startsWith(second) || second.startsWith(first));
}

export function getConversationMemory(history = [], currentMessage = "") {
  const candidates = Array.isArray(history)
    ? history
        .filter((message) =>
          (message?.role === "user" || message?.role === "assistant")
          && typeof message.content === "string"
          && message.content.trim(),
        )
        .map((message) => ({
          role: message.role,
          content: message.content.slice(0, MAX_CONTEXT_CHARS),
        }))
    : [];
  let messages = candidates.slice(-MAX_CONTEXT_MESSAGES);
  if (currentMessage && candidates.length > 4) {
    const queryTokens = messageTokens(currentMessage);
    const recent = candidates.slice(-4);
    const recentIndexes = new Set(
      Array.from({ length: Math.min(4, candidates.length) }, (_, index) => candidates.length - 1 - index),
    );
    const relevantOlder = candidates
      .map((message, index) => ({
        message,
        index,
        score: [...messageTokens(message.content)].filter((token) => queryTokens.has(token)).length,
      }))
      .filter(({ index, score }) => score > 0 && !recentIndexes.has(index))
      .sort((first, second) => second.score - first.score || second.index - first.index)
      .slice(0, MAX_RELEVANT_CONTEXT_MESSAGES - recent.length)
      .sort((first, second) => first.index - second.index)
      .map(({ message }) => message);
    messages = [...relevantOlder, ...recent];
  }

  return {
    messages,
    instructions: messages.length
      ? "Usa apenas o histórico recente abaixo para manter a continuidade desta conversa. Não afirmes recordar outras conversas nem infiras dados pessoais não fornecidos."
      : "Não há contexto anterior nesta conversa. Pergunta apenas os detalhes necessários; não infiras dados pessoais.",
  };
}

const memoryCategoryTerms = {
  interests: new Set(["interesse", "gosto", "gostas", "favorito", "favorita", "hobby", "curto"]),
  goals: new Set(["objetivo", "meta", "metas", "plano", "planos", "futuro", "quero"]),
  preferences: new Set(["prefiro", "preferencia", "estilo", "formato", "resposta", "lingua", "tom"]),
  favorite_topics: new Set(["assunto", "assuntos", "tema", "temas", "topico", "topicos"]),
  projects: new Set(["projeto", "projetos", "trabalho", "iniciativa", "negocio"]),
};

const intentMemoryCategories = {
  education: new Set(["interests", "goals", "favorite_topics", "projects"]),
  business: new Set(["goals", "preferences", "projects", "interests"]),
  content: new Set(["interests", "preferences", "favorite_topics", "projects"]),
  relationships: new Set(["preferences", "goals"]),
  local: new Set(["interests", "preferences", "projects"]),
  general: new Set(),
};

export function getRelevantUserMemory(items = [], currentMessage = "", intent = {}) {
  if (!Array.isArray(items) || !currentMessage.trim()) return [];
  const queryTokens = messageTokens(currentMessage);
  const inferredCategories = intentMemoryCategories[intent.category] || intentMemoryCategories.general;
  const scored = items.flatMap((item) => {
    if (
      !item
      || typeof item.category !== "string"
      || typeof item.content !== "string"
      || !item.content.trim()
    ) return [];
    const categoryTerms = memoryCategoryTerms[item.category];
    if (!categoryTerms) return [];
    return item.content.split(/\r?\n/)
      .map((content) => content.trim())
      .filter(Boolean)
      .map((content) => {
        const tokens = messageTokens(content);
        const overlap = [...tokens].filter((token) =>
          [...queryTokens].some((queryToken) => tokenMatches(token, queryToken)),
        ).length;
        const categoryOverlap = [...categoryTerms].some((token) => queryTokens.has(token));
        const categoryScore = overlap > 0 && inferredCategories.has(item.category) ? 0.5 : 0;
        return {
          category: item.category,
          content,
          score: overlap + (categoryOverlap ? 1 : 0) + categoryScore,
        };
      })
      .filter(({ score, content }) =>
        score > 0 && (messageTokens(content).size > 0),
      );
  });

  return scored
    .sort((first, second) => second.score - first.score)
    .slice(0, 4)
    .map(({ category, content }) => ({ category, content }));
}
