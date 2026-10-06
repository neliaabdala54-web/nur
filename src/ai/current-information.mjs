import { generateWithModel, hasAiApiKey } from "./model-client.mjs";

const EMPTY_RESULT = {
  answer: "",
  sources: [],
  retrievedAt: null,
  hasCurrentEvidence: false,
};

export function formatCurrentSearchFailure(status) {
  if (status === 401 || status === 403) {
    return "A pesquisa atual não foi autorizada. O administrador deve verificar a configuração e as permissões do serviço Gemini.";
  }
  if (status === 429) {
    return "A pesquisa atual atingiu o limite de utilização da Gemini. Tenta novamente mais tarde; não consigo confirmar esta informação agora.";
  }
  if (status === 400) {
    return "A pesquisa atual foi rejeitada pelo serviço Gemini. O administrador deve verificar a configuração do modelo.";
  }
  if (Number.isInteger(status) && status >= 500) {
    return "A pesquisa atual está temporariamente indisponível. Tenta novamente mais tarde; não consigo confirmar esta informação agora.";
  }
  return "A pesquisa de informação atual não ficou disponível neste momento. Não consigo confirmar esta informação agora; tenta novamente mais tarde ou confirma diretamente com a instituição ou serviço responsável.";
}

export async function searchCurrentInformation(query, options = {}) {
  const environment = options.environment || process.env;
  if (!hasAiApiKey(environment)) {
    return { ...EMPTY_RESULT };
  }

  const result = await generateWithModel([
    {
      role: "system",
      content: [
        "Responde em português à pergunta usando Google Search Grounding para verificar informação atual.",
        "Não inventes factos nem fontes. Se não conseguires confirmar, diz isso claramente.",
        "Usa apenas afirmações suportadas pelas fontes recuperadas e mantém as citações/fonte fornecidas pela ferramenta.",
      ].join(" "),
    },
    { role: "user", content: query },
  ], {
    ...options,
    environment,
    googleSearch: true,
    includeGroundingMetadata: true,
    timeoutMs: 30_000,
  });

  return result;
}

export function formatCurrentInformation(currentInfo) {
  if (currentInfo.searchFailed) {
    return currentInfo.searchFailureMessage || formatCurrentSearchFailure();
  }
  if (!currentInfo.hasCurrentEvidence) {
    return "Não encontrei fontes atuais suficientes para confirmar esta informação. Não vou inventar uma resposta; confirma diretamente com a instituição, serviço ou fonte responsável.";
  }

  return [
    currentInfo.answer,
    "",
    `Fontes verificadas em ${(currentInfo.retrievedAt || "").slice(0, 10)}:`,
    ...currentInfo.sources.slice(0, 5).map(
      (source, index) => `${index + 1}. ${source.title}: ${source.url}`,
    ),
  ].join("\n");
}
