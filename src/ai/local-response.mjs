import { normalizeSearchText } from "./categories.mjs";

const dynamicFields = [
  { keys: ["horario", "horarios", "hours"], fields: ["hours"], label: "horário" },
  { keys: ["contacto", "contactos", "telefone", "phone", "whatsapp"], fields: ["phone", "whatsapp"], label: "contacto" },
  { keys: ["preco", "precos", "price", "disponibilidade", "aberto", "aberta", "funciona"], fields: ["price", "state"], label: "disponibilidade" },
];

function asksForField(question, aliases) {
  const normalized = normalizeSearchText(question);
  return aliases.some((alias) => normalized.includes(alias));
}

function visibleValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function renderRecord(record, question) {
  const details = [];
  const addDetail = (label, value) => {
    const text = visibleValue(value);
    if (text && !details.some((item) => item.toLocaleLowerCase("pt-MZ") === `${label}: ${text}`.toLocaleLowerCase("pt-MZ"))) {
      details.push(`${label}: ${text}`);
    }
  };

  addDetail("Bairro", record.neighbourhood);
  addDetail("Localização", record.location);
  addDetail("Endereço", record.address);
  addDetail("Plus Code", record.plusCode);
  addDetail("Contacto registado na base", record.phone);
  addDetail("WhatsApp registado na base", record.whatsapp);
  addDetail("Email registado na base", record.email);
  addDetail("Website registado na base", record.website);
  addDetail("Horário registado na base", record.hours);
  addDetail("Serviços registados", record.services);
  addDetail("Descrição", record.description);
  addDetail("Observações", record.observations);

  if (record.state && record.state !== "ATIVO") {
    addDetail("Estado registado", record.state);
  }
  if (record.confidence) {
    addDetail("Confiabilidade registada", record.confidence);
  }
  if (record.verifiedAt) {
    addDetail("Data de verificação", record.verifiedAt);
  } else {
    addDetail("Data de verificação", "não indicada na base");
  }

  const missingFields = dynamicFields
    .filter((field) => asksForField(question, field.keys))
    .filter((field) => !field.fields.some((fieldName) => visibleValue(record[fieldName])))
    .map((field) => field.label);

  const caveat = [];
  if (record.state === "A CONFIRMAR") {
    caveat.push("Este registo está marcado «A CONFIRMAR» na base.");
  } else if (record.state === "DADO ANTIGO") {
    caveat.push("Este registo está marcado como dado antigo; confirma se continua válido.");
  } else if (record.state === "ATIVO") {
    caveat.push("A indicação «ATIVO» é o estado registado na base, não uma confirmação em tempo real.");
  }
  if (normalizeSearchText(record.confidence) === "baixa") {
    caveat.push("A confiabilidade deste registo está marcada como baixa.");
  }
  if (!record.verifiedAt) {
    caveat.push("A base não indica uma data de verificação para este registo.");
  }
  if (missingFields.length) {
    caveat.push(`Não encontrei ${[...new Set(missingFields)].join(" nem ")} confirmado para este registo.`);
  }

  return [
    `**${record.name}**${record.category ? ` — ${record.category}` : ""}`,
    ...details.map((detail) => `   ${detail}`),
    ...caveat.map((note) => `   Nota: ${note}`),
  ].join("\n");
}

function currentSearchContext(currentInfo, dynamicInformation) {
  if (!dynamicInformation) return [];
  const currentSources = currentInfo?.sources?.filter((source) => source.isCurrent) || [];
  if (currentSources.length) {
    return [
      "",
      `Resultados de fontes recentes (consultados em ${(currentInfo.retrievedAt || "").slice(0, 10)}; não equivalem a confirmação oficial):`,
      ...currentSources.slice(0, 3).flatMap((source) => [
        `• ${source.title}${source.publishedAt ? ` — publicado em ${source.publishedAt}` : ""}`,
        `  “${source.excerpt}”`,
        `  ${source.url}`,
      ]),
    ];
  }
  return [
    "",
    currentInfo?.searchFailed
      ? "A pesquisa externa falhou, por isso não consegui validar informação atual."
      : currentInfo?.sources?.length
      ? "Encontrei referências sem data de publicação recente confirmável; não posso apresentá-las como informação atual."
      : "Não encontrei uma fonte atual suficientemente verificável para confirmar esta informação dinâmica.",
    "Os dados da base local, quando apresentados, são apenas os valores registados e não confirmam a situação atual. Confirma diretamente com a instituição ou serviço.",
  ];
}

export function buildMaxixeResponse(question, search, selections = {}, { currentInfo, dynamicInformation = false } = {}) {
  if (search.locality === "ambiguous" || search.locality === "ambiguous-inhambane") {
    return "Estás a perguntar sobre a Cidade de Maxixe ou sobre a Cidade de Inhambane? São locais diferentes, por isso prefiro confirmar antes de procurar na base certa.";
  }

  if (search.locality === "outside-maxixe") {
    return "A minha base oficial de estabelecimentos está focada em Maxixe e não encontrei dados confirmados para esse outro local. Se quiseres, posso ajudar a procurar uma opção em Maxixe.";
  }

  const records = selections.records || search.records;
  const facts = selections.facts || search.facts;

  if (search.neighbourhood && !records.length) {
    return `Não encontrei na base oficial um registo confirmado${search.requestedCategories[0] ? ` de ${search.requestedCategories[0]}` : ""} para o bairro «${search.neighbourhood}». Podes tentar outro bairro ou perguntar pela categoria sem indicar um bairro específico.`;
  }

  if (records.length) {
    const names = new Set(records.map((record) => record.id));
    const selectedRecords = search.records.filter((record) => names.has(record.id));
    const category = search.requestedCategories[0] || selectedRecords[0]?.category;
    const mentionsFoodPreference = /\b(frango|carne|peixe|marisco|camar[aã]o|caranguejo|polvo|menu|prato|refei[cç][ãa]o)\b/i
      .test(question);
    const asksOpenNow = /\b(aberto|aberta|abertos|abertas|agora)\b/i.test(question);
    const heading = selectedRecords.length === 1
      ? `Encontrei esta opção na base oficial de Maxixe${category ? ` em «${category}»` : ""}:`
      : `Encontrei estas opções na base oficial de Maxixe${category ? ` em «${category}»` : ""}:`;
    return [
      heading,
      "",
      selectedRecords.map((record) => renderRecord(record, question)).join("\n\n"),
      ...(mentionsFoodPreference
        ? ["", "A base não confirma menus nem pratos específicos. Estes registos não confirmam que o local prepare esse prato."]
        : []),
      ...(asksOpenNow
        ? ["", "A base não confirma disponibilidade em tempo real. «ATIVO» é apenas o estado registado e não garante que o local esteja aberto agora."]
        : []),
      ...currentSearchContext(currentInfo, dynamicInformation),
      "",
      "Horários, contactos, preços e funcionamento podem mudar. Confirma esses dados diretamente com o estabelecimento antes de te deslocares.",
    ].join("\n");
  }

  const dynamicContext = currentSearchContext(currentInfo, dynamicInformation);
  if (facts.length) {
    const identityQuestion = /\b(quem criou|criou o bot|criadora|fundadora|significa nur|significado de nur|origem do nome nur)\b/i
      .test(normalizeSearchText(question));
    const selectedFacts = identityQuestion
      ? facts.filter((fact) => fact.topic === "Identidade do Bot Nur")
      : facts;
    return [
      ...selectedFacts.map((fact) => fact.text),
      ...dynamicContext,
      "Esta informação vem da base técnica do Bot Nur; as descrições de tradições e datas históricas podem exigir confirmação adicional.",
    ].join("\n\n");
  }

  if (dynamicInformation && currentInfo?.sources?.some((source) => source.isCurrent)) {
    return [
      "Não encontrei um registo local correspondente na Base Oficial de Maxixe.",
      ...dynamicContext,
    ].join("\n\n");
  }

  if (search.neighbourhood) {
    return `Não encontrei na base oficial um registo confirmado${search.requestedCategories[0] ? ` de ${search.requestedCategories[0]}` : ""} para o bairro «${search.neighbourhood}». Podes tentar outro bairro ou perguntar pela categoria sem indicar um bairro específico.`;
  }

  if (search.requestedCategories.length) {
    return `Não encontrei um estabelecimento confirmado dessa categoria na base oficial de Maxixe. Se quiseres, tenta outra categoria ou indica um bairro específico.`;
  }

  return [
    "Não encontrei informação confirmada sobre esse assunto na base oficial de Maxixe. Podes reformular a pergunta ou indicar uma categoria ou um bairro específico.",
    ...dynamicContext,
  ].filter(Boolean).join("\n\n");
}
