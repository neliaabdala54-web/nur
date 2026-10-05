export function assessReliability({ intent, localFacts = [], currentSources = [] }) {
  const hasCurrentSources = currentSources.some((source) => source.isCurrent === true);
  const hasUnverifiedSources = currentSources.length > 0 && !hasCurrentSources;
  const asksForCurrentInformation = intent.needsCurrentInformation;

  return {
    currentInformationVerified: !asksForCurrentInformation || hasCurrentSources,
    instructions: [
      "Separa factos confirmados, inferências e sugestões. Não apresentes estimativas como factos.",
      localFacts.length
        ? "A base local contém referências de enquadramento, não confirma horários, contactos nem disponibilidade."
        : "Não existe informação local verificada para esta pergunta.",
      hasCurrentSources
        ? "Para afirmações dinâmicas, usa exclusivamente fontes HTTPS indicadas como recentes. Não apresentes informação sem data como atual e indica a data de publicação e de consulta quando disponível."
        : asksForCurrentInformation
          ? `Foi pedido um dado que pode mudar, mas ${hasUnverifiedSources ? "as fontes encontradas não têm data de publicação recente confirmável" : "não há fontes atuais verificadas"}. Não afirmes valores, horários, contactos, eventos, emprego, transportes ou disponibilidade como atuais; declara a limitação e recomenda confirmação junto da instituição, serviço ou fonte responsável.`
          : "Se não souberes responder com confiança, sê transparente e indica o que precisa de confirmação.",
    ].join(" "),
  };
}

export function appendVerifiedSources(answer, sources) {
  if (!sources.length) return answer;
  const references = sources
    .slice(0, 5)
    .map((source, index) =>
      `${index + 1}. ${source.title}${source.publishedAt ? ` (publicada em ${source.publishedAt})` : ""}: ${source.url}`,
    )
    .join("\n");
  const retrievedAt = sources.find((source) => source.retrievedAt)?.retrievedAt;
  return `${answer}\n\nFontes consultadas${retrievedAt ? ` em ${retrievedAt.slice(0, 10)}` : ""}:\n${references}`;
}
