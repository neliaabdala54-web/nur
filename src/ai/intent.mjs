import {
  findRequestedCategories,
  identifyRequestedLocality,
  normalizeSearchText,
} from "./categories.mjs";
import { getMaxixeSearchIndex } from "./maxixe-knowledge.mjs";
import { getTourismIntent } from "./tourism-life.mjs";

const patterns = {
  greeting: /(?:^|[\s,!.?¿¡])(ol[aá]|oi|bom dia|boa tarde|boa noite|hey|sauda[cç][õo]es)(?:$|[\s,!.?¿¡])/iu,
  education: /\b(trabalho|escolar|escola|mat[eé]ria|explica|explicar|estud(?:ar|o|os|a|as)|projeto escolar|universidade|curso|disciplina|aluno|exame|teste|prova|pesquisa|resumo|resumir|exerc[ií]cio|exerc[ií]cios|li[cç][ãa]o|dever|tarefa|matem[aá]tica|portugu[eê]s|ingl[eê]s|ci[eê]ncias?|hist[oó]ria|geografia|inform[aá]tica|programa[cç][ãa]o|biologia|f[ií]sica|qu[ií]mica|reda[cç][ãa]o|gram[aá]tica|traduz|tradu[cç][ãa]o|equa[cç][ãa]o|fra[cç][ãa]o|derivada|integral|multiplica[cç][ãa]o|divis[aã]o|soma|subtra[cç][ãa]o)\b/i,
  business: /\b(neg[oó]cio(?:s)?|empreendedor(?:ismo|es)?|empreender|renda extra|vender|empresa(?:s)?|lucro|capital inicial|ideia(?:s)? de neg[oó]cio|plano(?:s)? de neg[oó]cio|plano(?:s)? de empresa|cliente(?:s)?|produto(?:s)?|custo(?:s)?|or[cç]amento|marketing|concorr[eê]ncia|concorrente(?:s)?|an[uú]ncio(?:s)?|publicidade|estrat[eé]gia de vendas|melhorar as vendas|oportunidade(?:s)? de neg[oó]cio|marca|nome para (?:a )?empresa|abrir (?:uma )?loja|abrir (?:um )?neg[oó]cio|microempresa)\b/i,
  relationships: /\b(amig[oa]s?|amizade|conversa|comunica[cç][ãa]o|relacionamento|conflito|paquera)\b/i,
  content: /\b(ideia|ideias|conte[uú]do|publica[cç][ãa]o|legenda|redes sociais|tiktok|instagram|facebook)\b/i,
  mozambique: /\bmo[çc]ambique\b/i,
};

const currentInformation = /\b(quem (?:é|e) (?:o )?(?:president(?:e|a)?|primeiro[- ]ministro|ministro|governador(?:a)?)|hoje|agora|atual(?:izado|izada|izados|izadas)?|actual(?:izado|izada|izados|izadas)?|recente|recentes|hor[aá]rios?|contactos?|telefon(?:e|es)|whatsapp|endere[cç]o|pre[cç]os?|valor(?:es)?|tarifa(?:s)?|cust(?:o|os|a|am|ar|as)|aberto|aberta|abertos|abertas|evento(?:s)?|not[ií]cias|vaga(?:s)?|emprego(?:s)?|recrutamento|promo[cç][õo]es?|desconto(?:s)?|dispon[ií]vel|disponibilidade|funcionamento|transportes?|chapa(?:s)?|servi[cç]os?|matr[ií]culas?|inscri[cç][õo]es?|altera[cç][õo]es?)\b/i;
const identityQuestion = /\b(quem criou|criou o bot|criadora|fundadora|significa nur|significado de nur|origem do nome nur|porque foi criado|por que foi criado|motivo da cria[cç][ãa]o|homenagem)\b/i;
const genericEntityWords = new Set([
  "mocambique",
  "maxixe",
  "inhambane",
  "cidade",
  "provincia",
  "banco",
  "igreja",
  "farmacia",
  "escola",
  "hotel",
  "mercado",
  "comercial",
]);

function hasKnownLocalEntity(input, knowledge) {
  const query = normalizeSearchText(input);
  if (!knowledge?.records) return false;
  const queryWords = query.split(" ");
  return getMaxixeSearchIndex(knowledge).records.some(({ name }) => {
    const nameWords = name.split(" ").filter(
      (word) => word.length >= 5 && !genericEntityWords.has(word),
    );
    return name.length >= 4
      && (query.includes(name) || nameWords.some((word) => queryWords.includes(word)));
  });
}

export function identifyIntent(input, knowledge = null) {
  const text = typeof input === "string" ? input.trim() : "";
  const normalized = normalizeSearchText(text);
  const requestedCategories = findRequestedCategories(text);
  const isGreeting = patterns.greeting.test(text) && text.length < 100;
  const isCreatorQuestion = identityQuestion.test(normalized);
  const tourism = getTourismIntent(text);
  const hasBusinessIntent = patterns.business.test(text);
  const explicitSchoolContext = /\b(escolar|escola|classe|disciplina|exerc[ií]cio|teste|prova|li[cç][ãa]o|dever|mat[eé]ria)\b/i.test(text);
  const isEducation = patterns.education.test(text)
    && (!hasBusinessIntent || explicitSchoolContext)
    && (!tourism.isTourismQuestion || explicitSchoolContext);
  const isLocal = requestedCategories.length > 0
    || /\b(maxixe|inhambane)\b/i.test(normalized)
    || /\b(bairro|zona|localidade)\b/i.test(normalized)
    || tourism.isTourismQuestion && tourism.geography.places.length > 0
    || isCreatorQuestion
    || !isEducation && hasKnownLocalEntity(text, knowledge);
  const locality = isLocal
    ? identifyRequestedLocality(text)
    : null;

  let category = "general";
  if (isEducation) category = "education";
  else if (hasBusinessIntent) category = "business";
  else if (tourism.isTourismQuestion) category = "tourism";
  else if (patterns.relationships.test(text)) category = "relationships";
  else if (patterns.content.test(text)) category = "content";
  else if (patterns.mozambique.test(text) && !isLocal) category = "mozambique";
  else if (isLocal) category = "local";

  return {
    category,
    isGreeting,
    isCreatorQuestion,
    isEducation,
    isLocalQuestion: isLocal,
    isLocalDirectoryQuestion: requestedCategories.length > 0
      || !isEducation && hasKnownLocalEntity(text, knowledge),
    needsCurrentInformation: currentInformation.test(text),
    requestedCategories,
    locality: tourism.isTourismQuestion
      ? tourism.geography.scope === "maxixe"
        ? "maxixe"
        : ["ambiguous", "inhambane-ambiguous"].includes(tourism.geography.scope)
          ? "ambiguous-inhambane"
          : "outside-maxixe"
      : locality,
    tourism,
  };
}
