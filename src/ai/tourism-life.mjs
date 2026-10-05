import { normalizeSearchText } from "./categories.mjs";

const placeNames = [
  "Tofo",
  "Barra",
  "Vilankulo",
  "Vilanculos",
  "Massinga",
  "Morrumbene",
  "Jangamo",
  "Homoine",
  "Maputo",
  "Beira",
  "Maxixe",
];

const tourismTopic = /\b(praias?|locais tur[ií]sticos?|turismo|visitar|roteiros?|passeios?|atividades?|actividades?|eventos?|cultura|hist[oó]ria|gastronomia|comida t[ií]pica|transportes?|bairros?|com[eé]rcio|mercados?|hot[eé]is?|restaurantes?|alojamento|vida local)\b/i;
const dynamicTourismTopic = /\b(eventos?|hoje|agora|atual(?:izado|izada|izados|izadas)?|actual(?:izado|izada|izados|izadas)?|hor[aá]rios?|pre[cç]os?|disponibilidade|dispon[ií]vel|abert[oa]s?)\b/i;

function mentionedPlaces(normalized) {
  const places = placeNames.filter((name) => {
    const normalizedName = normalizeSearchText(name);
    return normalized === normalizedName
      || normalized.includes(` ${normalizedName} `)
      || normalized.startsWith(`${normalizedName} `)
      || normalized.endsWith(` ${normalizedName}`);
  });
  if (/\bcidade de inhambane\b/.test(normalized)) places.push("Cidade de Inhambane");
  else if (/\bprovincia de inhambane\b/.test(normalized)) places.push("Província de Inhambane");
  else if (/\binhambane\b/.test(normalized)) places.push("Inhambane");
  if (/\bmo[cç]ambique\b/.test(normalized)) places.push("Moçambique");
  return [...new Set(places)];
}

export function identifyTourismGeography(question) {
  const normalized = normalizeSearchText(question);
  const places = mentionedPlaces(normalized);
  const specificPlaces = places.filter(
    (place) => !["Moçambique", "Província de Inhambane"].includes(place),
  );
  const effectivePlaces = specificPlaces.length
    ? specificPlaces.filter((place) =>
      !(place === "Inhambane" && specificPlaces.length > 1),
    )
    : places;
  if (effectivePlaces.length > 1) {
    return { scope: "ambiguous", places: effectivePlaces };
  }
  const place = effectivePlaces[0];
  if (!place) return { scope: "maxixe", places: [] };
  if (place === "Maxixe") return { scope: "maxixe", places };
  if (place === "Província de Inhambane") return { scope: "inhambane-province", places };
  if (place === "Cidade de Inhambane") return { scope: "inhambane-city", places };
  if (place === "Inhambane") return { scope: "inhambane-ambiguous", places };
  if (place === "Moçambique") return { scope: "mozambique", places };
  return { scope: "other-locality", places };
}

export function getTourismIntent(question) {
  const geography = identifyTourismGeography(question);
  const isTourismQuestion = tourismTopic.test(question);
  return {
    isTourismQuestion,
    geography,
    needsCurrentInformation: dynamicTourismTopic.test(question),
  };
}

export function getTourismClarification(intent) {
  if (!intent.tourism?.isTourismQuestion) return null;
  const { scope, places } = intent.tourism.geography;
  if (scope === "inhambane-ambiguous") {
    return "Quando dizes «Inhambane», referes-te à Cidade de Inhambane ou à província de Inhambane? Assim procuro informação do destino certo.";
  }
  if (scope === "ambiguous") {
    return `Mencionaste destinos diferentes (${places.join(" e ")}). Qual deles queres consultar? Vou manter a informação de cada local separada para não misturar opções.`;
  }
  return null;
}

export function getTourismSources(intent, currentInfo) {
  const geography = intent.tourism?.geography;
  const sources = currentInfo?.sources || [];
  if (!geography || geography.scope === "maxixe") return sources;
  const destination = geography.places[0];
  if (!destination) return [];
  const destinationAliases = {
    "Cidade de Inhambane": ["Cidade de Inhambane", "Inhambane"],
    "Província de Inhambane": ["Província de Inhambane", "Inhambane"],
    "Moçambique": ["Moçambique", "Mozambique"],
    "Vilankulo": ["Vilankulo", "Vilanculos"],
    "Vilanculos": ["Vilankulo", "Vilanculos"],
  }[destination] || [destination];
  return sources.filter((source) => {
    const header = ` ${normalizeSearchText(`${source.title || ""} ${source.url || ""}`)} `;
    const excerpt = ` ${normalizeSearchText(source.excerpt || "")} `;
    return destinationAliases.some((alias) => {
      const phrase = ` ${normalizeSearchText(alias)} `;
      const mentionsDestination = header.includes(phrase) || excerpt.includes(phrase);
      if (!mentionsDestination) return false;
      const isBroadScope = ["Moçambique", "Província de Inhambane"].includes(destination);
      const hasConflictingPlaceInHeader = !isBroadScope && placeNames.some((place) =>
        !destinationAliases.some((destinationAlias) =>
          normalizeSearchText(destinationAlias) === normalizeSearchText(place),
        )
        && header.includes(` ${normalizeSearchText(place)} `),
      );
      return !hasConflictingPlaceInHeader;
    });
  });
}

export function getTourismContext(question, intent = {}, search = null, currentInfo = null) {
  if (!intent.tourism?.isTourismQuestion) return null;
  const { scope, places } = intent.tourism.geography;
  const localRecords = scope === "maxixe" && search?.locality === "maxixe"
    ? search.records.slice(0, 6)
    : [];
  const localFacts = scope === "maxixe" && search?.locality === "maxixe"
    ? search.facts.slice(0, 8)
    : [];
  const sources = getTourismSources(intent, currentInfo);

  return [
    "MÓDULO DE TURISMO E VIDA LOCAL DO BOT NUR:",
    "Ajuda com praias, locais turísticos, restaurantes, hotéis, mercados, cultura, história, gastronomia, transportes, bairros, eventos, atividades, comércio e serviços.",
    `Âmbito geográfico solicitado: ${scope}${places.length ? ` (${places.join(", ")})` : " (Maxixe por prioridade geográfica)"}.`,
    scope === "ambiguous" || scope === "inhambane-ambiguous"
      ? "Não mistures locais nem assumas se «Inhambane» significa a cidade ou a província. Faz uma pergunta curta para esclarecer o destino antes de listar opções."
      : "Respeita estritamente o destino pedido. Maxixe, Cidade de Inhambane, Tofo, Barra, Vilankulo e outras localidades são lugares diferentes; nunca transfiras estabelecimentos, praias, bairros, rotas ou eventos entre eles.",
    scope === "maxixe"
      ? "Para Maxixe, a Base Oficial é a fonte local prioritária. Usa apenas os registos e factos recuperados abaixo para afirmações sobre locais; se não houver dados, diz que não encontraste informação confirmada, sem completar com conhecimento geral do modelo."
      : "A base estruturada de Maxixe não é evidência sobre outro destino. Para esse lugar, usa somente fontes recuperadas e claramente associadas ao destino; sem evidência adequada, informa que não tens dados confirmados.",
    "Para horários, preços, eventos, funcionamento e disponibilidade, só afirma o que uma fonte recente recuperada confirma. Indica a data quando disponível; dados antigos ou sem data não confirmam a situação atual.",
    "A tua função é interpretar a pergunta e formular naturalmente os dados fornecidos, não criar estabelecimentos, atrações, praias, endereços, horários, preços, eventos, atividades, rotas nem factos culturais ou históricos.",
    localRecords.length || localFacts.length
      ? `Contexto recuperado da Base Oficial de Maxixe: <tourism_maxixe_evidence>${JSON.stringify({ records: localRecords, facts: localFacts })}</tourism_maxixe_evidence>`
      : "",
    sources.length
      ? `Resultados externos recuperados (não são dados da Base Oficial): <tourism_web_evidence>${JSON.stringify(sources.slice(0, 5))}</tourism_web_evidence>`
      : "Não há resultados externos recuperados nesta pergunta.",
    intent.tourism.needsCurrentInformation && !sources.some((source) => source.isCurrent)
      ? "Foi pedida informação dinâmica, mas não há fonte atual verificável que a confirme. Declara essa limitação e não inventes dados."
      : "",
    question ? `Pedido original do utilizador: ${question}` : "",
  ].filter(Boolean).join("\n\n");
}
