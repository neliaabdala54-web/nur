import { normalizeSearchText } from "./categories.mjs";

const subjects = [
  ["matemática", /\b(matem[aá]tica|[aá]lgebra|equa[cç][õo]es?|fra[cç][õo]es?|derivadas?|integrais?|geometria|trigonometria|porcentagem|multiplica[cç][ãa]o|divis[aã]o)\b/i],
  ["português", /\bportugu[eê]s\b/i],
  ["inglês", /\bingl[eê]s\b/i],
  ["ciências", /\bci[eê]ncias?\b/i],
  ["história", /\bhist[oó]ria\b/i],
  ["geografia", /\bgeografia\b/i],
  ["informática", /\b(inform[aá]tica|programa[cç][ãa]o|computador(?:es)?)\b/i],
  ["física", /\bf[ií]sica\b/i],
  ["química", /\bqu[ií]mica\b/i],
  ["biologia", /\bbiologia\b/i],
];

const taskTypes = [
  ["answer_check", /\b(verifica|corrige|confere|est[aá] certo|minha resposta|a minha resposta)\b/i],
  ["exercise", /\b(exerc[ií]cio|exerc[ií]cios|pratica|praticar|problema|problemas)\b/i],
  ["summary", /\b(resumo|resumir|sintetiza|sintetizar)\b/i],
  ["test_prep", /\b(prepara[cç][ãa]o|estudar para|teste|prova|exame)\b|\bpreparar\b.*\b(teste|prova|exame)\b/i],
  ["research", /\b(pesquisa|pesquisar|refer[eê]ncias|fontes|bibliografia)\b/i],
  ["project", /\b(projeto|projecto)\b/i],
  ["schoolwork", /\b(trabalho|li[cç][ãa]o|dever|tarefa)\b/i],
];

function identifyLevel(question) {
  const normalized = normalizeSearchText(question);
  const explicitLevel = normalized.match(/\b(?:classe|ano|nivel|ensino)\s*(?:da|do)?\s*(\d{1,2})(?:a|o)?\b/);
  if (explicitLevel) return `nível/ano referido pelo utilizador: ${explicitLevel[1]}`;
  const ordinalLevel = normalized.match(/\b(\d{1,2})\s*(?:[.ªº°]|[ao]\b)\s*(?:(?:classe|ano)\b)?/);
  if (ordinalLevel) return `nível/ano referido pelo utilizador: ${ordinalLevel[1]}`;
  if (/\b(primaria|primario|escola primaria)\b/.test(normalized)) return "ensino primário";
  if (/\b(secundaria|secundario|escola secundaria)\b/.test(normalized)) return "ensino secundário";
  if (/\b(universidade|universitario|faculdade|instituto superior)\b/.test(normalized)) return "ensino superior";
  if (/\b(iniciante|principiante|basico|do zero)\b/.test(normalized)) return "nível inicial indicado pelo utilizador";
  return null;
}

export function getEducationContext(question, intent = {}) {
  if (!intent.isEducation && intent.category !== "education") return null;

  const subject = subjects.find(([, pattern]) => pattern.test(question))?.[0] || null;
  const task = taskTypes.find(([, pattern]) => pattern.test(question))?.[0] || "explanation";
  const level = identifyLevel(question);
  const taskGuidance = {
    answer_check: "Verifica o raciocínio e o resultado apresentado pelo utilizador. Se houver erro, identifica o passo exato, explica porquê e convida a tentar corrigir.",
    exercise: "Resolve um exemplo explicado e, quando adequado, propõe um exercício semelhante. Não reveles logo a solução do exercício proposto, a menos que seja pedida.",
    test_prep: "Organiza a revisão em tópicos curtos, inclui perguntas de prática e explica as respostas quando forem pedidas.",
    summary: "Resume fielmente o material disponível. Se não tiveres texto ou âmbito suficiente, pergunta o tema ou pede o conteúdo; não inventes o que o material diria.",
    research: "Ajuda a delimitar a pergunta, estruturar secções e distinguir afirmações de evidências. Não inventes autores, livros, URLs, citações, páginas ou bibliografia. Se pedirem fontes, usa apenas fontes que tenham sido realmente fornecidas ou verificadas; caso contrário, pede o material ou diz que não podes confirmar referências.",
    project: "Ajuda a definir objetivo, etapas, materiais e forma de avaliar o resultado; diferencia sugestões de requisitos escolares confirmados.",
    schoolwork: "Ensina o raciocínio e ajuda o utilizador a desenvolver o trabalho com as próprias palavras. Pode dar um exemplo ou rascunho orientador, mas não afirme que o utilizador realizou atividades que não descreveu.",
    explanation: "Explica a ideia em passos claros, começando pelo conceito essencial. Usa exemplo concreto se ajudar a compreensão.",
  }[task];

  return [
    "MÓDULO EDUCACIONAL DO BOT NUR:",
    `Disciplina identificada pela mensagem: ${subject || "não especificada"}.`,
    `Tipo de ajuda identificado: ${task}.`,
    `Nível explicitamente indicado: ${level || "não indicado; começa com uma explicação acessível e ajusta ao vocabulário e às perguntas da pessoa, sem adivinhar classe, idade ou currículo"}.`,
    taskGuidance,
    "Explica passo a passo quando o problema exigir raciocínio, mostra os passos intermédios e unidades quando aplicável, e verifica se a conclusão corresponde ao enunciado.",
    "Usa exemplos adequados ao contexto de Moçambique quando isso tornar o conceito mais claro, sem presumir que todos os exemplos locais ou termos curriculares se aplicam.",
    "Se a disciplina, o enunciado, os dados ou o nível forem necessários para uma resposta correta e estiverem ausentes, faz uma pergunta curta; caso contrário, começa a ajudar e oferece aprofundamento.",
    "Não inventes fontes, referências, citações, dados de pesquisa, regras curriculares ou respostas que dependam de informação não fornecida.",
  ].join("\n");
}
