const MAX_SEARCH_RESULTS = 5;
const MAX_RESULT_CHARS = 1200;
const MIN_EXCERPT_CHARS = 40;
const MAX_CURRENT_AGE_DAYS = 90;

function safeUrl(value) {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:"
      || !parsed.hostname
      || parsed.username
      || parsed.password
      || parsed.hostname === "localhost"
      || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(parsed.hostname)
    ) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function isRecentPublication(publishedAt, retrievedAt) {
  if (typeof publishedAt !== "string" || !publishedAt.trim()) return false;
  const publicationTime = Date.parse(publishedAt);
  const retrievalTime = Date.parse(retrievedAt);
  if (!Number.isFinite(publicationTime) || publicationTime > retrievalTime) return false;
  return (retrievalTime - publicationTime) / 86_400_000 <= MAX_CURRENT_AGE_DAYS;
}

export async function searchCurrentInformation(query, {
  apiKey,
  apiUrl = "https://api.tavily.com/search",
  fetchImpl = fetch,
} = {}) {
  if (!apiKey) return { answer: "", sources: [] };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetchImpl(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        max_results: MAX_SEARCH_RESULTS,
        include_answer: true,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`O serviço de pesquisa respondeu com HTTP ${response.status}.`);
    }

    const data = await response.json();
    const retrievedAt = new Date().toISOString();
    const sources = Array.isArray(data.results)
      ? data.results.slice(0, MAX_SEARCH_RESULTS).flatMap((result, index) => {
        const url = safeUrl(result.url);
        const title = typeof result.title === "string" ? result.title.trim().slice(0, 240) : "";
        const excerpt = typeof result.content === "string"
          ? result.content.trim().slice(0, MAX_RESULT_CHARS)
          : "";
        return url && title && excerpt.length >= MIN_EXCERPT_CHARS
          ? [{
            id: `source-${index + 1}`,
            title,
            url,
            excerpt,
            publishedAt: typeof result.published_date === "string"
              ? result.published_date
              : typeof result.publishedAt === "string"
                ? result.publishedAt
                : null,
            retrievedAt,
            isCurrent: isRecentPublication(
              typeof result.published_date === "string"
                ? result.published_date
                : result.publishedAt,
              retrievedAt,
            ),
          }]
          : [];
      })
      : [];

    return {
      answer: typeof data.answer === "string" ? data.answer.slice(0, MAX_RESULT_CHARS) : "",
      sources,
      retrievedAt,
      hasCurrentEvidence: sources.some((source) => source.isCurrent),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function formatCurrentInformation(currentInfo) {
  const currentSources = currentInfo.sources.filter((source) => source.isCurrent);
  if (!currentSources.length) {
    return currentInfo.sources.length
      ? "Encontrei referências externas, mas sem data de publicação recente confirmável. Não posso apresentá-las como atuais; confirma diretamente com a instituição ou serviço."
      : "Não encontrei uma fonte atual suficientemente verificável para confirmar esta informação. Confirma diretamente com a instituição ou serviço.";
  }

  return [
    `Encontrei estas referências recentes (pesquisa consultada em ${(currentInfo.retrievedAt || "").slice(0, 10)}):`,
    ...currentSources.slice(0, 3).flatMap((source) => [
      `• ${source.title}${source.publishedAt ? ` — publicado em ${source.publishedAt}` : ""}`,
      `  “${source.excerpt}”`,
      `  ${source.url}`,
    ]),
    "Os excertos são apresentados tal como constam nos resultados de pesquisa; confirma dados importantes junto da fonte responsável.",
  ].join("\n");
}
