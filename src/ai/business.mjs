import { normalizeSearchText } from "./categories.mjs";

const businessTasks = [
  ["business_idea", /\b(ideia(?:s)?|oportunidade(?:s)?|que neg[oó]cio|o que posso vender|come[cç]ar)\b/i],
  ["business_plan", /\b(planos? de neg[oó]cios?|plano empresarial|plano de empresa)\b/i],
  ["customer_research", /\b(cliente(?:s)?|p[uú]blico[- ]alvo|quem compraria|mercado[- ]alvo)\b/i],
  ["product_definition", /\b(produto(?:s)?|servi[cç]o(?:s)?|cat[aá]logo)\b/i],
  ["costing", /\b(custo(?:s)?|or[cç]amento|capital inicial|investimento|pre[cç]o(?:s)?|quanto custa|quanto cobrar|lucro|margem)\b/i],
  ["marketing", /\b(marketing|divulga[cç][ãa]o|publicidade|estrat[eé]gia|an[uú]ncio(?:s)?|campanha(?:s)?)\b/i],
  ["naming", /\b(nome(?:s)?|marca|branding)\b/i],
  ["sales", /\b(venda(?:s)?|vender|melhorar as vendas|aumentar as vendas|cliente(?:s)?|negocia[cç][ãa]o)\b/i],
  ["competition", /\b(concorr[eê]ncia|concorrente(?:s)?|competidor(?:es)?|diferenciar)\b/i],
];

function asksForCurrentPrice(question) {
  const normalized = normalizeSearchText(question);
  return /\b(?:preco|precos|custo|custos|quanto custa|quanto cobro|quanto cobrar|preco atual|valor atual|tarifa|tarifas)\b/.test(normalized);
}

export function getBusinessContext(question, intent = {}, search = null, currentInfo = null) {
  if (intent.category !== "business") return null;
  const task = businessTasks.find(([, pattern]) => pattern.test(question))?.[0] || "business_advice";
  const localEvidence = search?.locality === "maxixe"
    ? {
      source: "Base de Dados Oficial do Bot Nur — Maxixe",
      records: search.records.slice(0, 6),
      facts: search.facts.slice(0, 8),
    }
    : null;
  const currentSources = currentInfo?.sources?.filter((source) => source.isCurrent) || [];

  return [
    "MÓDULO DE NEGÓCIOS E EMPREENDEDORISMO DO BOT NUR:",
    `Tipo de apoio identificado: ${task}.`,
    "Ajuda de forma prática a testar ideias de negócio, analisar oportunidades, estruturar planos, conhecer clientes, definir produtos e serviços, estimar custos, criar estratégias de marketing, nomes e anúncios, melhorar vendas e analisar concorrência.",
    "Adapta sugestões aos recursos e contexto de Moçambique e de Maxixe quando relevante. Não afirmes que uma oportunidade, procura, concorrente, licença ou condição de mercado local existe sem evidência.",
    "Se a pergunta disser respeito a Maxixe, usa os registos e factos locais recuperados abaixo como única base factual local. Não transformes registos antigos ou sem data em informação atual.",
    "Organiza a resposta, quando aplicável, nestas secções: DADO REAL (somente factos presentes na Base Oficial ou em fontes externas recentes identificadas); ESTIMATIVA (cálculo aproximado, com premissas e fórmula visíveis); SUGESTÃO (ideias, estratégias e recomendações, claramente não verificadas). Omite secções que não se apliquem e nunca rotules uma sugestão como dado real.",
    "Para cálculos de custos ou lucro, pede os valores necessários se faltarem. Só usa números fornecidos pelo utilizador ou presentes numa fonte verificada; qualquer cenário hipotético deve ser rotulado ESTIMATIVA e declarar cada premissa. Não apresentes estimativas como cotação nem como preço de mercado.",
    asksForCurrentPrice(question)
      ? currentSources.length
        ? "A pergunta pede custos ou preços sujeitos a mudança. Usa preços apenas se uma fonte atual verificável abaixo os publicar claramente; identifica fonte e data. Se não houver preço nessa evidência, declara que precisa de confirmação e não inventes números."
        : "A pergunta pede custos ou preços sujeitos a mudança, mas não há fonte atual verificável com preço. Declara que é preciso confirmar localmente. Podes oferecer uma estrutura de cálculo sem valores inventados."
      : "Se forem pedidos preços atuais, valores de fornecedores ou custos de mercado e não houver fonte atual verificável, não inventes valores; oferece uma estrutura para o utilizador preencher.",
    "Sugestões de marketing, nomes, anúncios e estratégias podem ser criadas livremente, mas apresenta-as como SUGESTÃO, nunca como desempenho comprovado nem promessa de vendas.",
    "Não inventes fontes, estatísticas, taxas de conversão, vendas, preços de concorrentes, custos reais, dados de procura, leis ou requisitos de licenciamento. Se precisares de dados que faltam, pergunta apenas o essencial.",
    localEvidence
      ? `Evidência local pesquisada na Base Oficial (se as listas estiverem vazias, não foi recuperado um dado relevante; não acrescentes entidades nem campos): <business_local_evidence>${JSON.stringify(localEvidence)}</business_local_evidence>`
      : "",
    currentSources.length
      ? `Fontes externas atuais recuperadas (são auxiliares e não substituem a base oficial): <business_current_sources>${JSON.stringify(currentSources.slice(0, 4))}</business_current_sources>`
      : "",
  ].filter(Boolean).join("\n\n");
}
