export const MAXIXE_CATEGORIES = [
  "Restaurantes",
  "Bares e lanchonetes",
  "Padarias",
  "Escolas",
  "Universidades",
  "Institutos superiores",
  "Institutos técnico-profissionais",
  "Hospitais",
  "Centros de saúde",
  "Farmácias",
  "Bancos",
  "ATMs",
  "Lojas",
  "Supermercados",
  "Mercados",
  "Empresas",
  "Serviços profissionais",
  "Hotéis",
  "Pensões",
  "Guest houses",
  "Igrejas",
  "Mesquitas",
  "Transportes",
  "Turismo",
  "Praias",
  "Locais de interesse",
  "Bairros",
  "Cultura",
  "História",
  "Tradições",
  "Gastronomia",
  "Agricultura",
  "Pesca",
  "Serviços públicos",
  "Tecnologia",
  "Telecomunicações",
  "Outros serviços locais",
];

const categoryAliases = new Map([
  ["Restaurantes", ["restaurante", "restaurantes", "comer", "comida", "onde comer", "frango", "almoçar", "almocar", "jantar", "refeições", "refeicoes", "takeaway", "take away", "comida para levar"]],
  ["Bares e lanchonetes", ["bar", "bares", "snack bar", "snack-bar", "lanchonete", "lanchonetes", "café", "cafe", "cafeteria", "pastelaria"]],
  ["Padarias", ["padaria", "padarias", "pão", "pao", "padaria"]],
  ["Escolas", ["escola", "escolas", "escola primária", "escola primaria", "escola secundária", "escola secundaria", "ensino básico", "ensino basico"]],
  ["Universidades", ["universidade", "universidades", "university"]],
  ["Institutos superiores", ["instituto superior", "institutos superiores", "ensino superior"]],
  ["Institutos técnico-profissionais", ["instituto técnico", "instituto tecnico", "técnico-profissional", "tecnico profissional", "formação profissional", "formacao profissional"]],
  ["Hospitais", ["hospital", "hospitais"]],
  ["Centros de saúde", ["centro de saúde", "centro de saude", "centros de saúde", "centros de saude", "unidade sanitária", "unidade sanitaria"]],
  ["Farmácias", ["farmácia", "farmacia", "farmácias", "farmacias", "medicamentos", "botica"]],
  ["Bancos", ["banco", "bancos"]],
  ["ATMs", ["atm", "atms", "multibanco", "caixa automático", "caixa automatico"]],
  ["Lojas", ["loja", "lojas", "mercearia", "mercearias", "comércio", "comercio"]],
  ["Supermercados", ["supermercado", "supermercados", "supermarket"]],
  ["Mercados", ["mercado", "mercados", "feira", "feiras", "mercado municipal"]],
  ["Empresas", ["empresa", "empresas", "companhia", "companhias", "indústria", "industria"]],
  ["Serviços profissionais", ["serviços profissionais", "servicos profissionais", "advogado", "advocacia", "contabilidade", "consultoria"]],
  ["Hotéis", ["hotel", "hotéis", "hoteis", "motel", "alojamento"]],
  ["Pensões", ["pensão", "pensao", "pensões", "penseos", "residencial"]],
  ["Guest houses", ["guest house", "guest houses", "casa de hóspedes", "casa de hospedes"]],
  ["Igrejas", ["igreja", "igrejas", "paróquia", "paroquia", "culto"]],
  ["Mesquitas", ["mesquita", "mesquitas", "mesquita muçulmana", "mesquita muculmana"]],
  ["Transportes", ["transporte", "transportes", "chapa", "chapas", "táxi", "taxi", "autocarro", "autocarros", "barco", "transfer"]],
  ["Turismo", ["turismo", "turístico", "turistico", "atrações", "atracoes", "visitar", "alojamento turístico"]],
  ["Praias", ["praia", "praias", "baía", "baia", "litoral"]],
  ["Locais de interesse", ["local de interesse", "locais de interesse", "ponto de interesse"]],
  ["Bairros", ["bairros", "zonas", "localidades"]],
  ["Cultura", ["cultura", "dança", "danca", "língua", "lingua"]],
  ["História", ["história", "historia", "histórico", "historico"]],
  ["Tradições", ["tradição", "tradições", "tradicao", "tradicoes", "costume", "costumes"]],
  ["Gastronomia", ["gastronomia", "comida típica", "comida tipica", "culinária", "culinaria", "pratos locais"]],
  ["Agricultura", ["agricultura", "agrícola", "agricola", "machamba", "cultivo"]],
  ["Pesca", ["pesca", "pescador", "pescadores", "pescado", "marisco", "peixe"]],
  ["Serviços públicos", ["serviço público", "serviços públicos", "servico publico", "servicos publicos", "repartição pública", "reparticao publica"]],
  ["Tecnologia", ["tecnologia", "informática", "informatica", "reparação de telemóveis", "reparacao de telemoveis"]],
  ["Telecomunicações", ["telecomunicações", "telecomunicacoes", "operador móvel", "operador movel", "internet"]],
  ["Outros serviços locais", ["serviço local", "servico local", "serviços locais", "servicos locais"]],
]);

export function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-MZ")
    .replace(/[^\p{L}\p{N}+]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function containsPhrase(normalizedText, phrase) {
  const normalizedPhrase = normalizeSearchText(phrase);
  return normalizedText === normalizedPhrase
    || normalizedText.startsWith(`${normalizedPhrase} `)
    || normalizedText.endsWith(` ${normalizedPhrase}`)
    || normalizedText.includes(` ${normalizedPhrase} `);
}

function differsByAtMostOne(first, second) {
  if (Math.abs(first.length - second.length) > 1) return false;
  let firstIndex = 0;
  let secondIndex = 0;
  let differences = 0;
  while (firstIndex < first.length && secondIndex < second.length) {
    if (first[firstIndex] === second[secondIndex]) {
      firstIndex += 1;
      secondIndex += 1;
    } else if (differences++ === 0 && first.length !== second.length) {
      if (first.length < second.length) secondIndex += 1;
      else firstIndex += 1;
    } else if (differences === 1) {
      firstIndex += 1;
      secondIndex += 1;
    } else {
      return false;
    }
  }
  return differences + Number(firstIndex < first.length || secondIndex < second.length) <= 1;
}

function matchesAlias(normalizedText, alias) {
  if (containsPhrase(normalizedText, alias)) return true;
  const aliasWords = normalizeSearchText(alias).split(" ");
  if (aliasWords.length !== 1) return false;
  const queryWords = normalizedText.split(" ");
  return aliasWords.some((aliasWord) =>
    aliasWord.length >= 5
    && queryWords.some((queryWord) => differsByAtMostOne(queryWord, aliasWord)),
  );
}

export function findRequestedCategories(input) {
  const normalized = normalizeSearchText(input);
  const matches = [];
  for (const category of MAXIXE_CATEGORIES) {
    if (
      category === "Bairros"
      && !normalized.split(" ").some((word) => ["bairros", "zonas", "localidades"].includes(word))
    ) {
      continue;
    }
    const aliases = categoryAliases.get(category) || [category];
    if (aliases.some((alias) => matchesAlias(normalized, alias))) {
      matches.push(category);
    }
  }
  if (matches.includes("Restaurantes") && matches.includes("Pesca")) {
    return matches.filter((category) => category !== "Pesca");
  }
  return matches;
}

export function inferMaxixeNeighbourhood(input, knowledge = {}) {
  const normalized = normalizeSearchText(input);
  const neighbourhoodFact = knowledge.facts?.find((fact) =>
    normalizeSearchText(fact.topic).startsWith("bairro"),
  );
  const neighbourhoodList = neighbourhoodFact?.text?.split(":").slice(1).join(":") || "";
  const candidates = new Map();
  for (const item of neighbourhoodList.split(",")) {
    const candidate = item.trim().replace(/\.$/, "");
    if (candidate.includes("/")) {
      const groups = candidate.match(/^(.*?)\s+([^/]+)\/([^/]+)$/);
      if (groups) {
        for (const suffix of groups.slice(2)) {
          const name = `${groups[1]} ${suffix}`.trim();
          candidates.set(normalizeSearchText(name), name);
        }
      }
    } else if (candidate) {
      candidates.set(normalizeSearchText(candidate), candidate);
    }
  }
  for (const record of knowledge.records || []) {
    if (record.neighbourhood) {
      candidates.set(normalizeSearchText(record.neighbourhood), record.neighbourhood);
    }
  }
  for (const [candidate, original] of candidates) {
    if (containsPhrase(normalized, candidate)) return original;
  }

  const explicit = input.match(/\b(?:bairro|zona|localidade)\s+(?:de\s+)?([\p{L}\p{N}][\p{L}\p{N}'-]*(?:\s+[\p{L}\p{N}][\p{L}\p{N}'-]*){0,2})/iu);
  if (!explicit) return null;
  const requested = normalizeSearchText(explicit[1])
    .replace(/\s+(?:em|na|no|de|maxixe|por favor)\b.*$/i, "")
    .trim();
  return requested || null;
}

export function identifyRequestedLocality(input) {
  const normalized = normalizeSearchText(input);
  const explicitMaxixe = containsPhrase(normalized, "maxixe");
  const cityOfInhambane = /\bcidade de inhambane\b/.test(normalized);
  const otherLocalities = [
    "tofo", "barra", "massinga", "vilankulo", "vilanculos", "morrumbene",
    "jangamo", "homoine", "homoíne", "maputo", "beira",
  ].filter((name) => containsPhrase(normalized, name));

  if (explicitMaxixe && (cityOfInhambane || otherLocalities.length)) return "ambiguous";
  if (explicitMaxixe) return "maxixe";
  if (cityOfInhambane || otherLocalities.length) return "outside-maxixe";

  if (containsPhrase(normalized, "inhambane")) return "ambiguous-inhambane";
  return "maxixe";
}
