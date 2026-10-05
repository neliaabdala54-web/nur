import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  findRequestedCategories,
  inferMaxixeNeighbourhood,
  identifyRequestedLocality,
  normalizeSearchText,
} from "./categories.mjs";

const officialKnowledgeFile = fileURLToPath(
  new URL("../../knowledge/maxixe-official.json", import.meta.url),
);
const technicalKnowledgeFiles = [
  fileURLToPath(new URL("../../Bot_Nur_Maxixe_Base_Tecnica_v1.json", import.meta.url)),
  fileURLToPath(new URL("../../knowledge/Bot_Nur_Maxixe_Base_Tecnica_v1.json", import.meta.url)),
];
const supplementalKnowledgeFile = fileURLToPath(
  new URL("../../knowledge/maxixe.json", import.meta.url),
);
const indexCache = new WeakMap();
let knowledgePromise;

function normalizeKey(value) {
  return String(value)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-MZ")
    .replace(/[^a-z0-9]/g, "");
}

function readField(object, aliases) {
  if (!object || typeof object !== "object" || Array.isArray(object)) return undefined;
  const normalizedAliases = new Set(aliases.map(normalizeKey));
  const match = Object.entries(object).find(([key, value]) =>
    normalizedAliases.has(normalizeKey(key)) && value !== undefined,
  );
  return match?.[1];
}

function normalizeRecord(record) {
  const aliases = {
    id: ["id", "ID"],
    name: ["name", "nome"],
    category: ["category", "categoria"],
    subcategory: ["subcategory", "subcategoria"],
    city: ["city", "cidade"],
    neighbourhood: ["neighbourhood", "neighborhood", "bairro"],
    location: ["location", "localizacao", "localidade"],
    address: ["address", "endereco"],
    plusCode: ["plusCode", "plus_code", "codigo_mais"],
    latitude: ["latitude", "lat"],
    longitude: ["longitude", "lon", "lng"],
    phone: ["phone", "telefone", "contacto", "contato"],
    whatsapp: ["whatsapp"],
    email: ["email", "e-mail"],
    website: ["website", "site", "url"],
    hours: ["hours", "horario", "horarios"],
    services: ["services", "servicos"],
    description: ["description", "descricao"],
    source: ["source", "fonte"],
    verifiedAt: ["verifiedAt", "data_verificacao", "data_de_verificacao"],
    state: ["state", "estado"],
    confidence: ["confidence", "confiabilidade", "confianca", "nivel_confiabilidade"],
    observations: ["observations", "observacoes", "notas"],
  };
  const normalized = { ...record };
  for (const [field, names] of Object.entries(aliases)) {
    const value = readField(record, names);
    if (value !== undefined) normalized[field] = value;
  }
  if (typeof normalized.state === "string") {
    normalized.state = normalized.state
      .trim()
      .replaceAll("_", " ")
      .replaceAll("-", " ")
      .replace(/\s+/g, " ")
      .toLocaleUpperCase("pt-MZ");
  }
  if (typeof normalized.confidence === "string") {
    normalized.confidence = normalized.confidence
      .trim()
      .replaceAll("_", " ")
      .replace(/\s+/g, " ")
      .toLocaleUpperCase("pt-MZ");
  }
  return normalized;
}

export function normalizeOfficialKnowledge(source) {
  const data = source?.data && typeof source.data === "object" ? source.data : source;
  const metadata = readField(data, ["metadata", "metadados"]) || {};
  const scope = readField(data, ["geographicScope", "geographic_scope", "ambito_geografico"])
    || readField(metadata, ["geographicScope", "geographic_scope", "ambito_geografico"])
    || {};
  const records = readField(data, ["records", "establishments", "estabelecimentos", "registros", "registos"]);
  const facts = readField(data, ["facts", "factos", "conhecimentos", "localFacts", "conhecimentoLocal"]);
  const categories = readField(data, ["categories", "categorias"])
    || readField(metadata, ["categories", "categorias"]);
  const declaredCity = readField(scope, ["city", "cidade"])
    || readField(data, ["city", "cidade"])
    || readField(metadata, ["city", "cidade"]);

  if (!Array.isArray(records)) {
    throw new Error("O JSON da Base Técnica de Maxixe não contém uma lista de registos reconhecida.");
  }

  const normalizedRecords = records.map(normalizeRecord);
  const normalizedFacts = Array.isArray(facts)
    ? facts.map((fact) => ({
      ...fact,
      id: readField(fact, ["id", "ID"]),
      topic: readField(fact, ["topic", "tema", "categoria"]),
      text: readField(fact, ["text", "texto", "conhecimento", "descricao"]),
      confidence: readField(fact, ["confidence", "confiabilidade", "confianca"]),
    }))
    : [];

  return {
    ...metadata,
    ...data,
    geographicScope: scope,
    categories: Array.isArray(categories)
      ? categories
      : [...new Set(normalizedRecords.map((record) => record.category).filter(Boolean))],
    records: normalizedRecords,
    facts: normalizedFacts,
    declaredCity,
  };
}

function assertOfficialKnowledge(official) {
  if (
    !official
    || !Array.isArray(official.categories)
    || !Array.isArray(official.records)
    || !Array.isArray(official.facts)
  ) {
    throw new Error("A base oficial de Maxixe está incompleta ou tem um formato inválido.");
  }
  const declaredCity = normalizeSearchText(official.declaredCity || official.geographicScope?.city);
  if (declaredCity && declaredCity !== "maxixe") {
    throw new Error("A fonte principal da base local não está declarada como sendo de Maxixe.");
  }
  for (const record of official.records) {
    if (
      typeof record.id !== "string"
      || typeof record.name !== "string"
      || typeof record.category !== "string"
      || record.city && normalizeSearchText(record.city) !== "maxixe"
      || !record.city && declaredCity !== "maxixe"
    ) {
      throw new Error("A base oficial de Maxixe contém um registo territorialmente inválido.");
    }
  }
  for (const fact of official.facts) {
    if (typeof fact.id !== "string" || typeof fact.topic !== "string" || typeof fact.text !== "string") {
      throw new Error("A base oficial de Maxixe contém um facto local incompleto.");
    }
  }
}

function buildSearchIndex(knowledge) {
  const records = knowledge.records.map((record) => ({
    record,
    name: normalizeSearchText(record.name),
    tokens: new Set(normalizeSearchText([
      record.name,
      record.category,
      record.subcategory,
      record.neighbourhood,
      record.location,
      record.address,
      record.services,
      record.description,
      record.observations,
    ].filter(Boolean).join(" ")).split(" ")),
    category: normalizeSearchText(record.category),
    neighbourhood: normalizeSearchText(record.neighbourhood),
    state: normalizeSearchText(record.state),
  }));
  const facts = knowledge.facts.map((fact) => ({
    fact,
    topic: normalizeSearchText(fact.topic),
    text: normalizeSearchText(fact.text),
    tokens: new Set(normalizeSearchText(`${fact.topic} ${fact.text}`).split(" ")),
  }));
  const index = { records, facts };
  indexCache.set(knowledge, index);
  return index;
}

export function getMaxixeSearchIndex(knowledge) {
  return indexCache.get(knowledge) || buildSearchIndex(knowledge);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function loadMaxixeKnowledge() {
  knowledgePromise ??= (async () => {
    let officialSource;
    for (const path of technicalKnowledgeFiles) {
      try {
        officialSource = normalizeOfficialKnowledge(await readJson(path));
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }

    if (!officialSource) {
      console.warn(
        "Bot_Nur_Maxixe_Base_Tecnica_v1.json não encontrado; a integração mantém a base oficial local já existente.",
      );
      officialSource = normalizeOfficialKnowledge(await readJson(officialKnowledgeFile));
    }

    const supplemental = await readJson(supplementalKnowledgeFile);
    assertOfficialKnowledge(officialSource);
    const officialFactIds = new Set(officialSource.facts.map((fact) => fact.id));
      const supplementalFacts = supplemental.facts.filter(
        (fact) => typeof fact.id === "string" && !officialFactIds.has(fact.id),
      );
      const combined = {
        ...officialSource,
        facts: [...officialSource.facts, ...supplementalFacts],
      };
      buildSearchIndex(combined);
      return combined;
  })().catch((error) => {
    knowledgePromise = undefined;
    throw error;
  });
  return knowledgePromise;
}

function editDistanceAtMostOne(first, second) {
  if (Math.abs(first.length - second.length) > 1) return false;
  let firstIndex = 0;
  let secondIndex = 0;
  let edits = 0;
  while (firstIndex < first.length && secondIndex < second.length) {
    if (first[firstIndex] === second[secondIndex]) {
      firstIndex += 1;
      secondIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (first.length > second.length) firstIndex += 1;
    else if (second.length > first.length) secondIndex += 1;
    else {
      firstIndex += 1;
      secondIndex += 1;
    }
  }
  if (firstIndex < first.length || secondIndex < second.length) edits += 1;
  return edits <= 1;
}

function scoreNameSearch(queryWords, recordIndex) {
  if (!queryWords.length) return 0;
  const candidatePhrase = queryWords.join(" ");
  if (recordIndex.name === candidatePhrase) return 15;
  if (
    recordIndex.name.startsWith(`${candidatePhrase} `)
    || recordIndex.name.includes(` ${candidatePhrase} `)
    || candidatePhrase.length >= 4 && recordIndex.name.includes(candidatePhrase)
  ) {
    return 11;
  }

  const nameWords = recordIndex.name.split(" ");
  const hits = queryWords.filter((queryWord) =>
    nameWords.some((nameWord) =>
      nameWord.includes(queryWord)
      || queryWord.length >= 5 && editDistanceAtMostOne(queryWord, nameWord),
    ),
  ).length;
  return hits ? Math.round(8 * hits / queryWords.length) : 0;
}

function recordIsUnavailable(recordIndex) {
  return recordIndex.state.includes("fechado")
    || recordIndex.state === "duplicado";
}

function recordConfidence(recordIndex) {
  const confidence = normalizeSearchText(recordIndex.record.confidence);
  const statusScore = {
    alta: 3,
    media: 2,
    baixa: 1,
  }[confidence] || 0;
  const reviewScore = recordIndex.state === "ativo"
    ? 1
    : recordIndex.state === "confirmar"
      ? 0
      : -1;
  return [statusScore, reviewScore];
}

function recordFreshness(record) {
  if (!record.verifiedAt) return 0;
  const verifiedAt = Date.parse(record.verifiedAt);
  if (!Number.isFinite(verifiedAt)) return 0;
  const ageDays = Math.max(0, (Date.now() - verifiedAt) / 86_400_000);
  if (ageDays <= 90) return 4;
  if (ageDays <= 365) return 3;
  if (ageDays <= 1_095) return 2;
  return 1;
}

function deduplicateRecords(records) {
  const unique = [];
  const seen = new Set();
  for (const candidate of records) {
    if (recordIsUnavailable(candidate)) continue;
    const key = [
      candidate.name,
      candidate.category,
      candidate.neighbourhood,
      normalizeSearchText(candidate.record.plusCode || candidate.record.location),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

const queryNoise = new Set([
  "a", "as", "ao", "aos", "com", "de", "da", "das", "do", "dos",
  "em", "na", "nas", "no", "nos", "por", "para", "pelo", "pela",
  "que", "qual", "quais", "onde", "tem", "têm", "tenho", "existem",
  "existe", "conheces", "conhece", "preciso", "quero", "gostava",
  "gostaria", "procuro", "procura", "encontra", "encontrar", "podes",
  "pode", "me", "um", "uma", "uns", "umas", "favor", "mais", "perto",
  "quem", "criou", "bot", "nur", "fala", "fale", "diz", "diga", "conta",
  "conte", "sabes", "sei", "sobre",
  "cidade", "provincia", "maxixe", "inhambane", "mozambique", "mocambique",
  "hoje", "agora", "atual", "actual", "horario", "horarios", "contacto",
  "contactos", "telefone", "endereco", "preco", "precos", "aberto", "aberta",
]);

export function findMaxixeFacts(input, knowledge, { limit = 5 } = {}) {
  const normalized = normalizeSearchText(input);
  const identityQuery = /\b(quem criou|criou o bot|criadora|fundadora|significa nur|significado de nur|origem do nome nur|porque foi criado|por que foi criado|motivo da criacao|homenagem)\b/i
    .test(normalized);
  const overviewQuery = /\b(?:que sabes|o que sabes|fala|fale|conta|conte|fala-me|fale-me)\b.*\bmaxixe\b|\bsobre maxixe\b/i
    .test(normalized)
    || /^(?:maxixe|cidade de maxixe|fala-me de maxixe|fale-me de maxixe)$/.test(normalized);
  if (identityQuery) {
    limit = Math.max(limit, 8);
  }
  if (overviewQuery) {
    const overviewTopics = new Set([
      "identidade",
      "historia",
      "geografia",
      "cultura",
      "gastronomia",
      "turismo",
    ]);
    return getMaxixeSearchIndex(knowledge).facts
      .filter(({ fact }) => overviewTopics.has(normalizeSearchText(fact.topic)))
      .sort((first, second) => {
        const firstConfidence = normalizeSearchText(first.fact.confidence) === "alta" ? 1 : 0;
        const secondConfidence = normalizeSearchText(second.fact.confidence) === "alta" ? 1 : 0;
        return secondConfidence - firstConfidence;
      })
      .slice(0, limit)
      .map(({ fact }) => fact);
  }
  const queryTokens = normalized.split(" ").filter((token) =>
    token.length >= 3 && !queryNoise.has(token),
  );
  const index = getMaxixeSearchIndex(knowledge);
  const topicQuestion = new Map([
    ["historia", new Set(["historia", "origem do nome"])],
    ["cultura", new Set(["cultura", "linguas", "línguas"])],
    ["tradicoes", new Set(["cultura"])],
    ["geografia", new Set(["geografia", "bairros", "identidade"])],
    ["bairros", new Set(["bairros"])],
    ["agricultura", new Set(["agricultura"])],
    ["pesca", new Set(["pesca"])],
    ["gastronomia", new Set(["gastronomia"])],
    ["praias", new Set(["turismo", "geografia"])],
    ["turismo", new Set(["turismo", "visita e serviços", "geografia"])],
    ["local de interesse", new Set(["turismo", "geografia"])],
  ]);
  const requestedTopic = [...topicQuestion].find(([topic]) =>
    normalized.split(" ").includes(topic),
  )?.[1];
  const focusedFacts = requestedTopic
    ? index.facts.filter(({ topic }) =>
      [...requestedTopic].some((candidate) => topic.includes(normalizeSearchText(candidate))),
    )
    : index.facts;

  return focusedFacts
    .map(({ fact, topic, text, tokens }) => {
      if (identityQuery && fact.topic === "Identidade do Bot Nur") {
        return { fact, score: 40 };
      }
      if (!queryTokens.length) return { fact, score: 0 };
      const requestedTopicScore = requestedTopic
        && [...requestedTopic].some((candidate) => topic.includes(normalizeSearchText(candidate)))
        ? 40
        : 0;
      const topicMatch = queryTokens.filter((token) =>
        topic.includes(token) || token.includes(topic) && topic.length >= 5,
      ).length;
      const contentMatches = queryTokens.filter((token) =>
        tokens.has(token)
        || token.length >= 5 && [...tokens].some((candidate) => editDistanceAtMostOne(token, candidate)),
      ).length;
      const phraseMatch = queryTokens.length > 0
        && text.includes(queryTokens.slice(0, 2).join(" "))
        ? 3
        : 0;
      return {
        fact,
        score: requestedTopicScore + topicMatch * 6 + contentMatches * 2 + phraseMatch,
      };
    })
    .filter(({ score }) => score > 0)
    .sort((first, second) => second.score - first.score)
    .slice(0, limit)
    .map(({ fact }) => fact);
}

export function searchMaxixeKnowledge(input, knowledge, intent = {}) {
  const locality = intent.locality || identifyRequestedLocality(input);
  const categoryMatches = intent.requestedCategories || findRequestedCategories(input);
  const knowledgeOnlyCategories = new Set([
    "bairros",
    "cultura",
    "gastronomia",
    "historia",
    "praias",
    "tradicoes",
  ]);
  const directoryCategories = categoryMatches.filter(
    (category) => !knowledgeOnlyCategories.has(normalizeSearchText(category)),
  );
  const categorySet = new Set(directoryCategories.map(normalizeSearchText));
  const requestedNeighbourhood = intent.neighbourhood
    || inferMaxixeNeighbourhood(input, knowledge);
  const normalizedNeighbourhood = normalizeSearchText(requestedNeighbourhood);
  const normalizedSubcategory = normalizeSearchText(intent.subcategory);
  const normalizedRequestedState = normalizeSearchText(intent.state);
  const normalizedQuery = normalizeSearchText(input);
  const index = getMaxixeSearchIndex(knowledge);
  const shouldSearchDirectory = intent.isLocalDirectoryQuestion || directoryCategories.length > 0;
  const queryTokens = normalizedQuery.split(" ").filter((token) =>
    token.length >= 3
    && !queryNoise.has(token)
    && !["bairro", "zona", "localidade"].includes(token)
    && !directoryCategories.some((category) => normalizeSearchText(category).split(" ").includes(token))
    && !normalizedNeighbourhood.split(" ").includes(token),
  );

  const records = locality === "maxixe"
    && shouldSearchDirectory
    && (!categoryMatches.length || directoryCategories.length > 0)
    ? deduplicateRecords(index.records
      .filter((recordIndex) => !recordIsUnavailable(recordIndex))
      .filter((recordIndex) =>
        !categorySet.size || categorySet.has(recordIndex.category),
      )
      .filter((recordIndex) =>
        !normalizedNeighbourhood || recordIndex.neighbourhood === normalizedNeighbourhood,
      )
      .filter((recordIndex) =>
        !intent.filters?.openNow || recordIndex.state === "ativo",
      )
      .filter((recordIndex) =>
        !normalizedRequestedState || recordIndex.state === normalizedRequestedState,
      )
      .map((recordIndex) => ({
        ...recordIndex,
        score: (categorySet.has(recordIndex.category) ? 12 : 0)
          + scoreNameSearch(queryTokens, recordIndex)
          + queryTokens.filter((token) => recordIndex.tokens.has(token)).length
          + (normalizedSubcategory
            && normalizedSubcategory.split(" ").every((token) => recordIndex.tokens.has(token))
            ? 5
            : 0),
      }))
      .filter((recordIndex) => recordIndex.score > 0 || normalizedNeighbourhood)
      .sort((first, second) => {
        if (second.score !== first.score) return second.score - first.score;
        const stateOrder = (record) => ({
          ativo: 4,
          confirmar: 3,
          "dado antigo": 1,
          "temporariamente fechado": 0,
          fechado: 0,
          duplicado: 0,
        }[record.state] || 0);
        if (stateOrder(second) !== stateOrder(first)) return stateOrder(second) - stateOrder(first);
        const firstConfidence = recordConfidence(first);
        const secondConfidence = recordConfidence(second);
        return secondConfidence[0] - firstConfidence[0]
          || secondConfidence[1] - firstConfidence[1]
          || recordFreshness(second.record) - recordFreshness(first.record)
          || first.record.name.localeCompare(second.record.name, "pt");
      })
      )
      .slice(0, 6)
      .map((recordIndex) => recordIndex.record)
    : [];

  const factCategories = new Set([
    "agricultura",
    "bairros",
    "cultura",
    "gastronomia",
    "historia",
    "locais de interesse",
    "pesca",
    "praias",
    "tradicoes",
    "turismo",
  ]);
  const canSearchFacts = !categoryMatches.length
    || categoryMatches.some((category) => factCategories.has(normalizeSearchText(category)));
  const facts = locality === "outside-maxixe"
    || locality === "ambiguous"
    || locality === "ambiguous-inhambane"
    || !canSearchFacts
    ? []
    : findMaxixeFacts(input, knowledge, { limit: 5 });

  return {
    locality,
    requestedCategories: categoryMatches,
    neighbourhood: requestedNeighbourhood,
    records,
    facts,
    isLocalQuery: categoryMatches.length > 0
      || /\b(maxixe|inhambane)\b/i.test(input)
      || /\b(bairro|zona|localidade)\b/i.test(input)
      || records.length > 0,
  };
}

export {
  findRequestedCategories,
  inferMaxixeNeighbourhood,
  identifyRequestedLocality,
  normalizeSearchText,
};
